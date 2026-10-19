import type { Db } from '../db.js';
import { withTx } from '../db.js';
import type { SessionUser } from './auth.js';
import { isStaff } from './auth.js';
import { AppError } from '../util.js';

export const MAX_MESSAGE_LENGTH = 500;
const FLOOD = { shortWindowSec: 10, shortMax: 5, longWindowSec: 300, longMax: 40 };

/**
 * 클라이언트가 보낸 채널 식별자를 실제 채널로 변환.
 * 'team'은 항상 본인 조로 해석하며, 'team:N'은 N이 본인 조일 때만 허용.
 */
export function resolveChannel(user: SessionUser, requested: unknown): string {
  if (requested === 'all') return 'all';
  if (requested === 'team') return `team:${user.teamNumber}`;
  if (typeof requested === 'string') {
    const m = /^team:([1-8])$/.exec(requested);
    if (m) {
      if (Number(m[1]) !== user.teamNumber) throw new AppError(403, 'forbidden_channel', '다른 조 채팅방에는 들어갈 수 없습니다.');
      return requested;
    }
  }
  throw new AppError(400, 'invalid_channel', '채팅방을 찾을 수 없습니다.');
}

export interface PublicMessage {
  id: string;
  channel: string;
  senderId: string;
  senderName: string;
  senderTeam: number;
  staff: boolean;
  body: string | null;
  state: 'ok' | 'deleted' | 'hidden';
  clientMsgId?: string;
  createdAt: string;
}

export function toPublic(r: any, viewerId?: string): PublicMessage {
  const state = r.hidden_at ? 'hidden' : r.deleted_at ? 'deleted' : 'ok';
  const out: PublicMessage = {
    id: r.id, channel: r.channel, senderId: r.sender_id, senderName: r.sender_name, senderTeam: r.sender_team,
    staff: r.sender_staff, body: state === 'ok' ? r.body : null, state, createdAt: new Date(r.created_at).toISOString(),
  };
  if (viewerId && viewerId === r.sender_id) out.clientMsgId = r.client_msg_id;
  return out;
}

export async function listMessages(db: Db, eventId: string, channel: string, viewerId: string, before?: string, limit = 50) {
  const params: unknown[] = [eventId, channel];
  let cursor = '';
  if (before) {
    const [ts, id] = before.split('|');
    if (!ts || !id || Number.isNaN(Date.parse(ts)) || !/^[0-9a-f-]{36}$/i.test(id)) throw new AppError(400, 'invalid_cursor', '목록을 다시 불러와 주세요.');
    params.push(ts, id);
    cursor = `AND (created_at, id) < ($3::timestamptz, $4::uuid)`;
  }
  params.push(Math.min(Math.max(limit, 1), 100));
  const { rows } = await db.query(
    `SELECT * FROM messages WHERE event_id=$1 AND channel=$2 ${cursor}
     ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
    params,
  );
  const messages = rows.reverse().map((r) => toPublic(r, viewerId));
  const nextCursor = rows.length === params[params.length - 1] && messages.length ? `${messages[0].createdAt}|${messages[0].id}` : null;
  return { messages, nextCursor };
}

export async function postMessage(db: Db, eventId: string, user: SessionUser, channel: string, input: { body: unknown; clientMsgId: unknown }) {
  const clientMsgId = input.clientMsgId;
  if (typeof clientMsgId !== 'string' || clientMsgId.length < 8 || clientMsgId.length > 100 || !/^[A-Za-z0-9_-]+$/.test(clientMsgId)) {
    throw new AppError(400, 'invalid_client_id', '메시지를 다시 보내 주세요.');
  }
  const body = typeof input.body === 'string' ? input.body.normalize('NFC').replace(/\r\n/g, '\n').trim() : '';
  if (!body) throw new AppError(400, 'empty_message', '메시지를 입력해 주세요.');
  if (body.length > MAX_MESSAGE_LENGTH) throw new AppError(400, 'message_too_long', `메시지는 ${MAX_MESSAGE_LENGTH}자까지 보낼 수 있습니다.`);

  return withTx(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['chat:' + user.participantId]);
    const prior = await tx.query(`SELECT * FROM messages WHERE sender_id=$1 AND client_msg_id=$2`, [user.participantId, clientMsgId]);
    if (prior.rows[0]) return { message: toPublic(prior.rows[0], user.participantId), replay: true };
    const flood = await tx.query<{ s: string; l: string }>(
      `SELECT count(*) FILTER (WHERE created_at > now() - make_interval(secs => $2)) AS s,
              count(*) AS l
       FROM messages WHERE sender_id=$1 AND created_at > now() - make_interval(secs => $3)`,
      [user.participantId, FLOOD.shortWindowSec, FLOOD.longWindowSec],
    );
    if (Number(flood.rows[0].s) >= FLOOD.shortMax || Number(flood.rows[0].l) >= FLOOD.longMax) {
      throw new AppError(429, 'flood', '메시지를 너무 빠르게 보내고 있어요. 잠시 후 다시 보내 주세요.');
    }
    const ins = await tx.query(
      `INSERT INTO messages (event_id, channel, sender_id, sender_name, sender_team, sender_staff, body, client_msg_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [eventId, channel, user.participantId, user.name, user.teamNumber, isStaff(user.role), body, clientMsgId],
    );
    return { message: toPublic(ins.rows[0], user.participantId), replay: false };
  });
}

export async function getMessageForUser(db: Db, eventId: string, user: SessionUser, messageId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) throw new AppError(404, 'not_found', '메시지를 찾을 수 없습니다.');
  const { rows } = await db.query(`SELECT * FROM messages WHERE id=$1 AND event_id=$2`, [messageId, eventId]);
  const m = rows[0];
  if (!m) throw new AppError(404, 'not_found', '메시지를 찾을 수 없습니다.');
  // 접근 가능한 방의 메시지만
  if (m.channel !== 'all' && m.channel !== `team:${user.teamNumber}` && !isStaff(user.role)) {
    throw new AppError(404, 'not_found', '메시지를 찾을 수 없습니다.');
  }
  return m;
}

export async function deleteOwnMessage(db: Db, eventId: string, user: SessionUser, messageId: string) {
  const m = await getMessageForUser(db, eventId, user, messageId);
  if (m.sender_id !== user.participantId) throw new AppError(403, 'not_owner', '내가 보낸 메시지만 삭제할 수 있습니다.');
  const { rows } = await db.query(`UPDATE messages SET deleted_at = COALESCE(deleted_at, now()) WHERE id=$1 RETURNING *`, [messageId]);
  return toPublic(rows[0], user.participantId);
}

export async function hideMessage(db: Db, eventId: string, admin: SessionUser, messageId: string, hidden: boolean) {
  const { rows } = await db.query(
    `UPDATE messages SET hidden_at = CASE WHEN $3 THEN COALESCE(hidden_at, now()) ELSE NULL END, hidden_by = CASE WHEN $3 THEN $2::uuid ELSE NULL END
     WHERE id=$1 AND event_id=$4 RETURNING *`,
    [messageId, admin.participantId, hidden, eventId],
  );
  if (!rows[0]) throw new AppError(404, 'not_found', '메시지를 찾을 수 없습니다.');
  return toPublic(rows[0]);
}

export async function reportMessage(db: Db, eventId: string, user: SessionUser, messageId: string, reason: unknown) {
  const m = await getMessageForUser(db, eventId, user, messageId);
  const r = typeof reason === 'string' ? reason.trim().slice(0, 200) : '';
  await db.query(
    `INSERT INTO message_reports (message_id, reporter_id, reason) VALUES ($1,$2,$3) ON CONFLICT (message_id, reporter_id) DO NOTHING`,
    [m.id, user.participantId, r],
  );
}

export async function markRead(db: Db, user: SessionUser, channel: string) {
  await db.query(
    `INSERT INTO channel_read_state (participant_id, channel, last_read_at) VALUES ($1,$2,clock_timestamp())
     ON CONFLICT (participant_id, channel) DO UPDATE SET last_read_at = EXCLUDED.last_read_at`,
    [user.participantId, channel],
  );
}

export async function unreadCounts(db: Db, eventId: string, user: SessionUser) {
  const team = `team:${user.teamNumber}`;
  const { rows } = await db.query(
    `SELECT ch, (SELECT count(*) FROM (
        SELECT 1 FROM messages m WHERE m.event_id=$1 AND m.channel=ch AND m.sender_id<>$2 AND m.deleted_at IS NULL AND m.hidden_at IS NULL
          AND m.created_at > COALESCE((SELECT last_read_at FROM channel_read_state WHERE participant_id=$2 AND channel=ch), '-infinity')
        LIMIT 99) x) AS n
     FROM unnest(ARRAY['all', $3]) AS ch`,
    [eventId, user.participantId, team],
  );
  const map = Object.fromEntries(rows.map((r) => [r.ch, Number(r.n)]));
  return { all: map.all ?? 0, team: map[team] ?? 0 };
}
