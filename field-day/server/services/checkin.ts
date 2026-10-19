import type { Db, Tx } from '../db.js';
import { withTx } from '../db.js';

export interface CheckinResult {
  ticketNumber: number;
  checkinSequence: number;
  checkedInAt: Date;
  isNew: boolean;
}

export interface CheckinHooks {
  /** 테스트용: 번호 확보 직후·저장 전에 호출 (실패 주입) */
  beforeInsert?: (seq: number, ticket: number) => Promise<void> | void;
}

/**
 * 최초 로그인 성공 시 체크인 + 행운권 배정.
 * 행사 할당 행 잠금 → 기존 배정 재확인 → 순번 확정 → 번호 확보 → 저장 → 카운터 반영 → COMMIT.
 * 어느 단계든 실패하면 트랜잭션 전체가 롤백되어 카운터도 그대로다.
 */
export async function ensureCheckin(db: Db, eventId: string, participantId: string, hooks: CheckinHooks = {}): Promise<CheckinResult> {
  // 빠른 경로: 이미 체크인했다면 잠금 없이 반환
  const existing = await db.query(
    `SELECT ticket_number, checkin_sequence, checked_in_at FROM checkins WHERE event_id=$1 AND participant_id=$2`,
    [eventId, participantId],
  );
  if (existing.rows[0]) return toResult(existing.rows[0], false);

  return withTx(db, async (tx: Tx) => {
    const state = await tx.query<{ next_sequence: number; pool_size: number }>(
      `SELECT next_sequence, pool_size FROM allocation_state WHERE event_id=$1 FOR UPDATE`,
      [eventId],
    );
    if (!state.rows[0]) throw new Error('allocation_state missing — run init-event');
    const again = await tx.query(
      `SELECT ticket_number, checkin_sequence, checked_in_at FROM checkins WHERE event_id=$1 AND participant_id=$2`,
      [eventId, participantId],
    );
    if (again.rows[0]) return toResult(again.rows[0], false);

    const seq = state.rows[0].next_sequence;
    let ticket: number;
    if (seq <= state.rows[0].pool_size) {
      const pool = await tx.query<{ ticket_number: number }>(
        `SELECT ticket_number FROM ticket_pool WHERE event_id=$1 AND position=$2`,
        [eventId, seq],
      );
      if (!pool.rows[0]) throw new Error('ticket pool exhausted unexpectedly');
      ticket = pool.rows[0].ticket_number;
    } else {
      ticket = seq;
    }
    if (hooks.beforeInsert) await hooks.beforeInsert(seq, ticket);
    const ins = await tx.query(
      `INSERT INTO checkins (event_id, participant_id, checkin_sequence, ticket_number)
       VALUES ($1,$2,$3,$4) RETURNING ticket_number, checkin_sequence, checked_in_at`,
      [eventId, participantId, seq, ticket],
    );
    await tx.query(`UPDATE allocation_state SET next_sequence = $2 WHERE event_id=$1`, [eventId, seq + 1]);
    return toResult(ins.rows[0], true);
  });
}

function toResult(row: { ticket_number: number; checkin_sequence: number; checked_in_at: Date }, isNew: boolean): CheckinResult {
  return { ticketNumber: row.ticket_number, checkinSequence: row.checkin_sequence, checkedInAt: row.checked_in_at, isNew };
}
