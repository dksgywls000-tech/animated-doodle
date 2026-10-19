import { randomInt } from 'node:crypto';
import type { Db } from '../db.js';
import { withTx } from '../db.js';

export const TICKET_POOL_SIZE = 300;

/** 보안 난수 Fisher–Yates 셔플 */
export function secureShuffle(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = n - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const CATEGORIES = [
  ['balloon', '1. 풍선기둥', 'main'],
  ['jumprope', '2. 단체줄넘기', 'main'],
  ['ballbounce', '3. 공 튕기기', 'main'],
  ['tuberelay', '4. 튜브릴레이', 'main'],
  ['event', '이벤트 게임', 'event'],
  ['cheer', '응원점수', 'cheer'],
] as const;

const EVENT_SUBTYPES = [
  ['balloon_pop', '풍선 빨리 터트리기'],
  ['event_jumprope', '이벤트 단체줄넘기'],
  ['jegi', '제기차기'],
  ['event_tube', '이벤트 튜브릴레이'],
  ['other', '기타 이벤트'],
] as const;

// 원문 운영표 중 참가자에게 공개해도 되는 항목만. 담당자 이름·설치 업무는 넣지 않는다.
type Seed = [start: string | null, end: string | null, title: string, note: string, kind: string, game: string | null, status: string];
const SCHEDULE: Seed[] = [
  ['12:10', null, '1회차 버스 출발', '공사팀 · 기존 귀향/퇴근버스 탑승지', 'general', null, 'scheduled'],
  ['12:20', '13:00', '도착 · 조끼 수령', '분수광장 하차 후 야외공연장까지 도보 이동. 추첨권·조별 위치 안내', 'general', null, 'scheduled'],
  ['12:30', null, '2회차 버스 출발', '지원팀 + 잔여 인원 · 배차는 별도 안내', 'general', null, 'scheduled'],
  ['13:00', '13:10', '인원 확인', '조끼 착용 후 조별 2줄 정렬', 'general', null, 'scheduled'],
  ['13:10', '13:15', '행사 식순 안내', '', 'general', null, 'scheduled'],
  ['13:15', '13:20', '개회사', '본부장', 'general', null, 'scheduled'],
  ['13:20', '13:25', '준비운동', '', 'general', null, 'scheduled'],
  ['13:25', '13:35', '조별 자리 이동', '조장 인솔 · 종목별 선수 안내', 'general', null, 'scheduled'],
  ['13:35', '13:40', '심판·선수 이동', '13:40까지 경기장으로 이동', 'general', null, 'scheduled'],
  ['13:40', '14:00', '풍선기둥 세우기 · 풍선 빨리 터트리기', '두 종목이 이어서 진행됩니다', 'main', 'balloon', 'scheduled'],
  ['14:00', '14:30', '단체줄넘기', '메인 경기', 'main', 'jumprope', 'scheduled'],
  ['14:30', '14:40', '이벤트 단체줄넘기', '', 'event', null, 'scheduled'],
  ['14:30', '15:00', '공 튕기기', '메인 경기 · 시작 시각 확인 중', 'main', 'ballbounce', 'time_tbd'],
  ['15:00', '15:15', '이벤트 제기차기', '조별 3명', 'event', null, 'scheduled'],
  ['15:15', '15:40', '튜브릴레이', '메인 경기', 'main', 'tuberelay', 'scheduled'],
  ['15:40', '16:00', '이벤트 튜브릴레이', '', 'event', null, 'scheduled'],
  [null, null, '추가 이벤트', '시간 여유가 있을 때 진행자가 운영', 'event', null, 'time_tbd'],
  ['16:05', '16:45', '소통 TALK', '조별 음식 지급', 'break', null, 'scheduled'],
  ['16:45', '17:00', '시상식 · 경품추첨', '', 'general', null, 'scheduled'],
  ['17:00', '17:15', '폐회사', '본부장', 'general', null, 'scheduled'],
  ['17:15', '17:20', '단체사진 · 조별 정리', '물품 반납', 'general', null, 'scheduled'],
];

const tournament = (pairs: [number, number][]) => pairs.map(([a, b], i) => ({ label: `${i + 1}경기`, a, b }));

const GAMES = [
  {
    key: 'balloon', number: 1, title: '풍선기둥 세우기',
    players: '조 전체 (현장 인원에 따라 조정)',
    summary: '두 조가 연합팀이 되어 풍선을 불고 쌓아 제한시간 안에 기둥을 세웁니다.',
    how_to: '풍선을 불어 기둥 모양으로 쌓습니다.\n제한시간은 진행자가 현장에서 안내합니다.\n종료 시점에 기둥 높이로 순위를 정합니다.\n각 조 안전관리 담당자는 경기에 참여하지 않고 안전을 살핍니다.',
    bracket: [{ label: '연합 A', a: 1, b: 2 }, { label: '연합 B', a: 3, b: 4 }, { label: '연합 C', a: 5, b: 7 }, { label: '연합 D', a: 6, b: 8 }],
    bracket_note: '연합팀 4개가 동시에 경기합니다.',
    image: '/assets/06_balloon_example.jpg',
    pending_note: '높이 측정 방법 등 세부 기준은 현장 진행자 안내를 따릅니다.',
  },
  {
    key: 'jumprope', number: 2, title: '단체줄넘기',
    players: '조별 12명 (점프 10명 + 줄잡이 2명)',
    summary: '토너먼트로 진행합니다. 연습 3분 후 2회 기록, 좋은 기록을 적용합니다.',
    how_to: '연습 3분이 주어집니다.\n조별로 2회 기록하고 더 좋은 기록을 적용합니다.\n이긴 조가 다음 경기로 올라갑니다.',
    bracket: tournament([[5, 6], [3, 8], [1, 2], [4, 7]]),
    bracket_note: '준결승: 1경기 승 vs 2경기 승 / 3경기 승 vs 4경기 승 → 결승',
    image: '/assets/07_jump_rope_example.jpg',
    pending_note: '',
  },
  {
    key: 'ballbounce', number: 3, title: '공 튕기기',
    players: '조별 20명',
    summary: '큰 천을 함께 잡고 대형 공을 튕깁니다. 연습 3분 후 2회 기록, 좋은 기록을 적용합니다.',
    how_to: '연습 3분이 주어집니다.\n조별로 2회 기록하고 더 좋은 기록을 적용합니다.\n이긴 조가 다음 경기로 올라갑니다.',
    bracket: tournament([[3, 5], [2, 8], [1, 6], [4, 7]]),
    bracket_note: '준결승: 1경기 승 vs 2경기 승 / 3경기 승 vs 4경기 승 → 결승',
    image: '/assets/08_ball_bounce_example.jpg',
    pending_note: '세부 동작과 기록 방식은 현장 진행자가 안내합니다.',
  },
  {
    key: 'tuberelay', number: 4, title: '튜브릴레이',
    players: '조별 30명 (편도 10명씩)',
    summary: '연습 없이 바로 토너먼트로 진행합니다.',
    how_to: '연습 없이 바로 경기합니다.\n편도 10명씩 이어서 달립니다.\n이긴 조가 다음 경기로 올라갑니다.',
    bracket: tournament([[2, 7], [1, 3], [4, 8], [5, 6]]),
    bracket_note: '준결승: 1경기 승 vs 2경기 승 / 3경기 승 vs 4경기 승 → 결승',
    image: '/assets/09_tube_relay_example.jpg',
    pending_note: '3·4위 결정 방식은 운영진 확정 전입니다.',
  },
];

export const SEAT_NOTES: Record<number, string> = {
  1: '배치도 왼쪽 아래 · 운영지원 바로 옆',
  2: '배치도 왼쪽 · 1조 위쪽',
  3: '배치도 가운데 왼쪽',
  4: '배치도 가운데',
  5: '배치도 오른쪽 윗줄',
  6: '배치도 오른쪽 윗줄 끝',
  7: '배치도 오른쪽 아랫줄',
  8: '배치도 오른쪽 아랫줄 끝',
};

/**
 * 행사 초기화 — 여러 번 실행해도 안전(이미 있는 행은 건드리지 않음).
 * 행운권 풀은 최초 1회만 생성하며 이후 절대 재생성하지 않는다.
 */
export async function initEvent(db: Db, eventId: string): Promise<{ created: boolean }> {
  return withTx(db, async (tx) => {
    const ins = await tx.query(
      `INSERT INTO events (id, title, event_date, venue, parking_note, departure_note)
       VALUES ($1, '2026 하이테크본부 가을운동회', '2026-10-21', '이충동 부락산 분수공원 야외공연장', $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [
        eventId,
        '자차 이용 시 이충문화체육센터 주차장. 원문 안내: 3시간 무료, 초과 요금은 개인 부담(지원 없음).',
        '기존 귀향/퇴근버스 탑승지에서 출발합니다. 버스 4대 2회 운행 예정이며 배차는 별도 안내됩니다.',
      ],
    );
    const created = (ins.rowCount ?? 0) > 0;
    for (let t = 1; t <= 8; t++) {
      await tx.query(
        `INSERT INTO teams (event_id, team_number, display_name, seat_note) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [eventId, t, `${t}조`, SEAT_NOTES[t]],
      );
    }
    const alloc = await tx.query(
      `INSERT INTO allocation_state (event_id, next_sequence, pool_size) VALUES ($1, 1, $2) ON CONFLICT DO NOTHING`,
      [eventId, TICKET_POOL_SIZE],
    );
    if ((alloc.rowCount ?? 0) > 0) {
      const shuffled = secureShuffle(TICKET_POOL_SIZE);
      await tx.query(
        `INSERT INTO ticket_pool (event_id, position, ticket_number)
         SELECT $1, p, n FROM unnest($2::int[], $3::int[]) AS u(p, n)`,
        [eventId, shuffled.map((_, i) => i + 1), shuffled],
      );
    }
    for (const [i, [key, label, kind]] of CATEGORIES.entries()) {
      await tx.query(
        `INSERT INTO score_categories (event_id, key, label, kind, sort_order) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [eventId, key, label, kind, i + 1],
      );
    }
    for (const [i, [key, label]] of EVENT_SUBTYPES.entries()) {
      await tx.query(
        `INSERT INTO score_subtypes (event_id, category_key, key, label, sort_order) VALUES ($1,'event',$2,$3,$4) ON CONFLICT DO NOTHING`,
        [eventId, key, label, i + 1],
      );
    }
    if (created) {
      for (const [i, [start, end, title, note, kind, game, status]] of SCHEDULE.entries()) {
        await tx.query(
          `INSERT INTO schedule_items (event_id, sort_order, start_time, end_time, title, note, kind, game_key, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [eventId, (i + 1) * 10, start, end, title, note, kind, game, status],
        );
      }
      for (const g of GAMES) {
        await tx.query(
          `INSERT INTO game_info (event_id, key, number, title, players, summary, how_to, bracket, bracket_note, image, pending_note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
          [eventId, g.key, g.number, g.title, g.players, g.summary, g.how_to, JSON.stringify(g.bracket), g.bracket_note, g.image, g.pending_note],
        );
      }
      await tx.query(
        `INSERT INTO audit_events (event_id, action, detail) VALUES ($1, 'event_initialized', $2)`,
        [eventId, JSON.stringify({ ticketPool: TICKET_POOL_SIZE })],
      );
    }
    return { created };
  });
}
