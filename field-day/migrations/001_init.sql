-- 001_init: 가을운동회 앱 기본 스키마
-- 모든 시각은 timestamptz(UTC 저장), 표시만 Asia/Seoul.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE events (
  id            text PRIMARY KEY,
  title         text NOT NULL,
  event_date    date NOT NULL,
  venue         text NOT NULL,
  -- 공개 설정 (참가자에게 보이는 안내만)
  schedule_published boolean NOT NULL DEFAULT false,
  parking_published  boolean NOT NULL DEFAULT false,
  parking_note       text NOT NULL DEFAULT '',
  return_bus_published boolean NOT NULL DEFAULT false,
  return_bus_note    text NOT NULL DEFAULT '',
  departure_note     text NOT NULL DEFAULT '',
  status_note        text NOT NULL DEFAULT '',
  status_note_updated_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teams (
  event_id    text NOT NULL REFERENCES events(id),
  team_number int  NOT NULL CHECK (team_number BETWEEN 1 AND 8),
  display_name text NOT NULL,
  seat_note   text NOT NULL DEFAULT '',
  PRIMARY KEY (event_id, team_number)
);

CREATE TABLE participants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     text NOT NULL REFERENCES events(id),
  employee_id  text NOT NULL CHECK (length(employee_id) BETWEEN 1 AND 64),
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
  team_number  int  NOT NULL CHECK (team_number BETWEEN 1 AND 8),
  role         text NOT NULL DEFAULT 'participant' CHECK (role IN ('participant','admin','owner')),
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, employee_id),
  FOREIGN KEY (event_id, team_number) REFERENCES teams(event_id, team_number)
);
CREATE INDEX participants_login_idx ON participants (event_id, employee_id, name);

CREATE TABLE sessions (
  token_hash   text PRIMARY KEY,           -- sha256(token) — 원문 토큰은 저장하지 않음
  participant_id uuid NOT NULL REFERENCES participants(id),
  csrf_token   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX sessions_participant_idx ON sessions (participant_id);

CREATE TABLE login_attempts (
  id          bigserial PRIMARY KEY,
  ip_key      text NOT NULL,
  account_key text NOT NULL,   -- HMAC(정규화 사번) — 원문 미저장
  success     boolean NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_ip_idx ON login_attempts (ip_key, created_at);
CREATE INDEX login_attempts_acct_idx ON login_attempts (account_key, created_at);

-- ── 행운권 ──────────────────────────────────────────────
CREATE TABLE allocation_state (
  event_id      text PRIMARY KEY REFERENCES events(id),
  next_sequence int NOT NULL DEFAULT 1 CHECK (next_sequence >= 1),
  pool_size     int NOT NULL DEFAULT 300
);

CREATE TABLE ticket_pool (
  event_id     text NOT NULL REFERENCES events(id),
  position     int  NOT NULL CHECK (position >= 1),
  ticket_number int NOT NULL CHECK (ticket_number >= 1),
  PRIMARY KEY (event_id, position),
  UNIQUE (event_id, ticket_number)
);

CREATE TABLE checkins (
  event_id        text NOT NULL REFERENCES events(id),
  participant_id  uuid NOT NULL REFERENCES participants(id),
  checkin_sequence int NOT NULL CHECK (checkin_sequence >= 1),
  ticket_number   int NOT NULL CHECK (ticket_number >= 1),
  checked_in_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, participant_id),
  UNIQUE (event_id, checkin_sequence),
  UNIQUE (event_id, ticket_number)
);

-- ── 점수 ────────────────────────────────────────────────
CREATE TABLE score_categories (
  event_id  text NOT NULL REFERENCES events(id),
  key       text NOT NULL,
  label     text NOT NULL,
  kind      text NOT NULL CHECK (kind IN ('main','event','cheer')),
  sort_order int NOT NULL,
  PRIMARY KEY (event_id, key)
);

CREATE TABLE score_subtypes (
  event_id     text NOT NULL,
  category_key text NOT NULL,
  key          text NOT NULL,
  label        text NOT NULL,
  sort_order   int NOT NULL,
  PRIMARY KEY (event_id, category_key, key),
  FOREIGN KEY (event_id, category_key) REFERENCES score_categories(event_id, key)
);

CREATE TABLE score_awards (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       text NOT NULL REFERENCES events(id),
  team_number    int  NOT NULL,
  category_key   text NOT NULL,
  subtype_key    text,
  points         int  NOT NULL CHECK (points BETWEEN 10 AND 200 AND points % 10 = 0),
  reason         text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 200),
  actor_id       uuid NOT NULL REFERENCES participants(id),
  actor_name     text NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, idempotency_key),
  FOREIGN KEY (event_id, team_number) REFERENCES teams(event_id, team_number),
  FOREIGN KEY (event_id, category_key) REFERENCES score_categories(event_id, key),
  FOREIGN KEY (event_id, category_key, subtype_key) REFERENCES score_subtypes(event_id, category_key, key)
);
CREATE INDEX score_awards_event_idx ON score_awards (event_id, created_at DESC);

CREATE TABLE score_reversals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  award_id       uuid NOT NULL UNIQUE REFERENCES score_awards(id),
  event_id       text NOT NULL REFERENCES events(id),
  points         int  NOT NULL CHECK (points < 0),
  reason         text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 200),
  actor_id       uuid NOT NULL REFERENCES participants(id),
  actor_name     text NOT NULL,
  idempotency_key text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, idempotency_key)
);

-- 원장은 수정·삭제 불가
CREATE FUNCTION forbid_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'score ledger rows are immutable';
END $$;
CREATE TRIGGER score_awards_immutable BEFORE UPDATE OR DELETE ON score_awards
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
CREATE TRIGGER score_reversals_immutable BEFORE UPDATE OR DELETE ON score_reversals
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

-- 취소액은 반드시 원점수의 정확한 음수
CREATE FUNCTION check_reversal_amount() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE orig int;
BEGIN
  SELECT points INTO orig FROM score_awards WHERE id = NEW.award_id;
  IF orig IS NULL OR NEW.points <> -orig THEN
    RAISE EXCEPTION 'reversal must exactly offset the original award';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER score_reversals_amount BEFORE INSERT ON score_reversals
  FOR EACH ROW EXECUTE FUNCTION check_reversal_amount();

CREATE TABLE cancel_attempts (
  id         bigserial PRIMARY KEY,
  actor_id   uuid NOT NULL,
  success    boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cancel_attempts_actor_idx ON cancel_attempts (actor_id, created_at);

-- ── 공지·일정·경기 ─────────────────────────────────────
CREATE TABLE announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    text NOT NULL REFERENCES events(id),
  title       text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 80),
  body        text NOT NULL DEFAULT '' CHECK (length(body) <= 1000),
  important   boolean NOT NULL DEFAULT false,
  published   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES participants(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE announcement_reads (
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  participant_id  uuid NOT NULL REFERENCES participants(id),
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, participant_id)
);

CREATE TABLE schedule_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    text NOT NULL REFERENCES events(id),
  sort_order  int NOT NULL,
  start_time  text CHECK (start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  end_time    text CHECK (end_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  title       text NOT NULL,
  note        text NOT NULL DEFAULT '',
  kind        text NOT NULL DEFAULT 'general' CHECK (kind IN ('general','main','event','break')),
  game_key    text,
  -- scheduled: 예정 / time_tbd: 시간 확인 중 / live: 진행 중(운영자 지정) / done: 종료 / delayed: 지연
  status      text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','time_tbd','live','done','delayed')),
  delay_note  text NOT NULL DEFAULT '',
  public      boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX schedule_items_event_idx ON schedule_items (event_id, sort_order);

CREATE TABLE game_info (
  event_id    text NOT NULL REFERENCES events(id),
  key         text NOT NULL,
  number      int NOT NULL,
  title       text NOT NULL,
  players     text NOT NULL DEFAULT '',
  summary     text NOT NULL DEFAULT '',
  how_to      text NOT NULL DEFAULT '',
  bracket     jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{label, a, b}] 1라운드만, 결과 미포함
  bracket_note text NOT NULL DEFAULT '',
  image       text,
  pending_note text NOT NULL DEFAULT '',
  published   boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, key)
);

-- ── 채팅 ────────────────────────────────────────────────
CREATE TABLE messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       text NOT NULL REFERENCES events(id),
  channel        text NOT NULL CHECK (channel ~ '^(all|team:[1-8])$'),
  sender_id      uuid NOT NULL REFERENCES participants(id),
  sender_name    text NOT NULL,
  sender_team    int  NOT NULL,
  sender_staff   boolean NOT NULL DEFAULT false,
  body           text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 500),
  client_msg_id  text NOT NULL CHECK (length(client_msg_id) BETWEEN 8 AND 100),
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at     timestamptz,
  hidden_at      timestamptz,
  hidden_by      uuid REFERENCES participants(id),
  UNIQUE (sender_id, client_msg_id)
);
CREATE INDEX messages_channel_idx ON messages (event_id, channel, created_at DESC, id DESC);

CREATE TABLE channel_read_state (
  participant_id uuid NOT NULL REFERENCES participants(id),
  channel        text NOT NULL,
  last_read_at   timestamptz NOT NULL,
  PRIMARY KEY (participant_id, channel)
);

CREATE TABLE message_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid NOT NULL REFERENCES messages(id),
  reporter_id uuid NOT NULL REFERENCES participants(id),
  reason      text NOT NULL DEFAULT '' CHECK (length(reason) <= 200),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  handled_by  uuid REFERENCES participants(id),
  handled_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, reporter_id)
);

-- ── 도움 요청 ───────────────────────────────────────────
CREATE TABLE help_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     text NOT NULL REFERENCES events(id),
  requester_id uuid NOT NULL REFERENCES participants(id),
  kind         text NOT NULL CHECK (kind IN ('route','supplies','other')),
  body         text NOT NULL DEFAULT '' CHECK (length(body) <= 300),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done')),
  client_req_id text NOT NULL,
  handled_by   uuid REFERENCES participants(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requester_id, client_req_id)
);

-- ── 감사 로그 ──────────────────────────────────────────
CREATE TABLE audit_events (
  id         bigserial PRIMARY KEY,
  event_id   text NOT NULL,
  actor_id   uuid,
  actor_name text,
  action     text NOT NULL,
  target     text,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_idx ON audit_events (event_id, created_at DESC);
