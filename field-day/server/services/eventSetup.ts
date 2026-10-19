import { randomInt } from 'node:crypto';
import type { Db } from '../db.js';
import { withTx } from '../db.js';

import { CATEGORIES, EVENT_SUBTYPES, SCHEDULE, GAMES, SEAT_NOTES } from './seedData.js';

export { SEAT_NOTES };
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
