import type { Db } from '../db.js';
import { withTx } from '../db.js';
import { verifyPassword } from '../config.js';
import type { SessionUser } from './auth.js';
import { AppError } from '../util.js';

export interface AwardInput {
  teamNumber: unknown;
  categoryKey: unknown;
  subtypeKey?: unknown;
  points: unknown;
  reason: unknown;
  idempotencyKey: unknown;
  confirmDuplicate?: unknown;
}

const DUPLICATE_WINDOW_SEC = 60;

export function validatePoints(points: unknown): number {
  if (typeof points !== 'number' || !Number.isInteger(points) || points < 10 || points > 200 || points % 10 !== 0) {
    throw new AppError(400, 'invalid_points', '점수는 10점부터 200점까지 10점 단위로만 부여할 수 있습니다.');
  }
  return points;
}

function validReason(reason: unknown, min = 1): string {
  const r = typeof reason === 'string' ? reason.normalize('NFC').trim() : '';
  if (r.length < min || r.length > 200) {
    throw new AppError(400, 'invalid_reason', min > 1 ? '구체적인 사유를 입력해 주세요. (2~200자)' : '사유를 입력해 주세요. (1~200자)');
  }
  return r;
}

function validKey(key: unknown): string {
  if (typeof key !== 'string' || key.length < 8 || key.length > 100 || !/^[A-Za-z0-9_-]+$/.test(key)) {
    throw new AppError(400, 'invalid_idempotency_key', '요청 식별값이 올바르지 않습니다. 화면을 새로고침해 주세요.');
  }
  return key;
}

export async function getCategories(db: Db, eventId: string) {
  const cats = await db.query(`SELECT key, label, kind FROM score_categories WHERE event_id=$1 ORDER BY sort_order`, [eventId]);
  const subs = await db.query(`SELECT category_key, key, label FROM score_subtypes WHERE event_id=$1 ORDER BY sort_order`, [eventId]);
  return cats.rows.map((c) => ({
    ...c,
    subtypes: subs.rows.filter((s) => s.category_key === c.key).map((s) => ({ key: s.key, label: s.label })),
  }));
}

export async function createAward(db: Db, eventId: string, actor: SessionUser, input: AwardInput) {
  const teamNumber = input.teamNumber;
  if (typeof teamNumber !== 'number' || !Number.isInteger(teamNumber) || teamNumber < 1 || teamNumber > 8) {
    throw new AppError(400, 'invalid_team', '1~8조 중에서 선택해 주세요.');
  }
  const points = validatePoints(input.points);
  const idempotencyKey = validKey(input.idempotencyKey);
  if (typeof input.categoryKey !== 'string') throw new AppError(400, 'invalid_category', '종목을 선택해 주세요.');
  const cat = await db.query(`SELECT key, label, kind FROM score_categories WHERE event_id=$1 AND key=$2`, [eventId, input.categoryKey]);
  if (!cat.rows[0]) throw new AppError(400, 'invalid_category', '종목을 선택해 주세요.');
  const kind = cat.rows[0].kind as string;
  let subtypeKey: string | null = null;
  if (kind === 'event') {
    if (typeof input.subtypeKey !== 'string') throw new AppError(400, 'invalid_subtype', '이벤트 세부 유형을 선택해 주세요.');
    const sub = await db.query(`SELECT 1 FROM score_subtypes WHERE event_id=$1 AND category_key='event' AND key=$2`, [eventId, input.subtypeKey]);
    if (!sub.rows[0]) throw new AppError(400, 'invalid_subtype', '이벤트 세부 유형을 선택해 주세요.');
    subtypeKey = input.subtypeKey;
  } else if (input.subtypeKey !== undefined && input.subtypeKey !== null) {
    throw new AppError(400, 'invalid_subtype', '이 종목에는 세부 유형이 없습니다.');
  }
  const reason = validReason(input.reason, kind === 'main' ? 1 : 2);

  return withTx(db, async (tx) => {
    // 같은 idempotency key는 한 번만 처리
    const prior = await tx.query(`SELECT * FROM score_awards WHERE event_id=$1 AND idempotency_key=$2`, [eventId, idempotencyKey]);
    if (prior.rows[0]) return replayOrConflict(prior.rows[0], actor, teamNumber, input.categoryKey as string, subtypeKey, points, reason);

    if (input.confirmDuplicate !== true) {
      const dup = await tx.query(
        `SELECT id, created_at FROM score_awards
         WHERE event_id=$1 AND actor_id=$2 AND team_number=$3 AND category_key=$4 AND subtype_key IS NOT DISTINCT FROM $5
           AND points=$6 AND reason=$7 AND created_at > now() - make_interval(secs => $8)
         ORDER BY created_at DESC LIMIT 1`,
        [eventId, actor.participantId, teamNumber, input.categoryKey, subtypeKey, points, reason, DUPLICATE_WINDOW_SEC],
      );
      if (dup.rows[0]) {
        throw new AppError(409, 'duplicate_warning', `방금 같은 내용(${teamNumber}조 · +${points}점 · ${reason})을 부여했습니다. 정말 한 번 더 부여할까요?`, { previousId: dup.rows[0].id });
      }
    }
    const ins = await tx.query(
      `INSERT INTO score_awards (event_id, team_number, category_key, subtype_key, points, reason, actor_id, actor_name, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (event_id, idempotency_key) DO NOTHING RETURNING *`,
      [eventId, teamNumber, input.categoryKey, subtypeKey, points, reason, actor.participantId, actor.name, idempotencyKey],
    );
    if (!ins.rows[0]) {
      const again = await tx.query(`SELECT * FROM score_awards WHERE event_id=$1 AND idempotency_key=$2`, [eventId, idempotencyKey]);
      return replayOrConflict(again.rows[0], actor, teamNumber, input.categoryKey as string, subtypeKey, points, reason);
    }
    return { award: ins.rows[0], replay: false };
  });
}

function replayOrConflict(row: any, actor: SessionUser, team: number, cat: string, sub: string | null, points: number, reason: string) {
  if (row.actor_id === actor.participantId && row.team_number === team && row.category_key === cat
    && row.subtype_key === sub && row.points === points && row.reason === reason) {
    return { award: row, replay: true };
  }
  throw new AppError(409, 'idempotency_conflict', '이미 처리된 다른 요청과 식별값이 겹칩니다. 화면을 새로고침한 뒤 다시 시도해 주세요.');
}

const CANCEL_LIMIT = { windowMin: 10, max: 5 };

export async function cancelAward(
  db: Db, eventId: string, actor: SessionUser, passwordHash: string,
  awardId: string, input: { password: unknown; reason: unknown; idempotencyKey: unknown },
) {
  if (!/^[0-9a-f-]{36}$/i.test(awardId)) throw new AppError(404, 'not_found', '점수 기록을 찾을 수 없습니다.');
  const idempotencyKey = validKey(input.idempotencyKey);
  const reason = validReason(input.reason, 2);

  const fails = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM cancel_attempts WHERE actor_id=$1 AND success=false AND created_at > now() - make_interval(mins => $2)`,
    [actor.participantId, CANCEL_LIMIT.windowMin],
  );
  if (Number(fails.rows[0].n) >= CANCEL_LIMIT.max) {
    throw new AppError(429, 'cancel_rate_limited', `비밀번호 오류가 많아 ${CANCEL_LIMIT.windowMin}분 동안 취소가 제한됩니다. 점수는 차감되지 않았습니다.`);
  }
  const password = typeof input.password === 'string' ? input.password : '';
  if (!password || password.length > 100 || !verifyPassword(password, passwordHash)) {
    await db.query(`INSERT INTO cancel_attempts (actor_id, success) VALUES ($1,false)`, [actor.participantId]);
    throw new AppError(403, 'bad_password', '취소 비밀번호가 맞지 않습니다. 점수는 차감되지 않았습니다.');
  }

  const result = await withTx(db, async (tx) => {
    const award = await tx.query(`SELECT * FROM score_awards WHERE id=$1 AND event_id=$2 FOR UPDATE`, [awardId, eventId]);
    if (!award.rows[0]) throw new AppError(404, 'not_found', '점수 기록을 찾을 수 없습니다.');
    const existing = await tx.query(`SELECT * FROM score_reversals WHERE award_id=$1`, [awardId]);
    if (existing.rows[0]) {
      if (existing.rows[0].idempotency_key === idempotencyKey && existing.rows[0].actor_id === actor.participantId) {
        return { reversal: existing.rows[0], award: award.rows[0], replay: true };
      }
      throw new AppError(409, 'already_cancelled', `이미 ${existing.rows[0].actor_name}님이 취소한 기록입니다. 다시 차감되지 않습니다.`);
    }
    const ins = await tx.query(
      `INSERT INTO score_reversals (award_id, event_id, points, reason, actor_id, actor_name, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [awardId, eventId, -award.rows[0].points, reason, actor.participantId, actor.name, idempotencyKey],
    );
    return { reversal: ins.rows[0], award: award.rows[0], replay: false };
  });
  await db.query(`INSERT INTO cancel_attempts (actor_id, success) VALUES ($1,true)`, [actor.participantId]);
  return result;
}

export async function getBoard(db: Db, eventId: string) {
  const { rows } = await db.query(
    `SELECT t.team_number, t.display_name,
       COALESCE((SELECT sum(points) FROM score_awards a WHERE a.event_id=t.event_id AND a.team_number=t.team_number),0)
       + COALESCE((SELECT sum(r.points) FROM score_reversals r JOIN score_awards a ON a.id=r.award_id
                   WHERE a.event_id=t.event_id AND a.team_number=t.team_number),0) AS total,
       (SELECT count(*) FROM score_awards a WHERE a.event_id=t.event_id AND a.team_number=t.team_number
          AND NOT EXISTS (SELECT 1 FROM score_reversals r WHERE r.award_id=a.id)) AS active_awards
     FROM teams t WHERE t.event_id=$1 ORDER BY t.team_number`,
    [eventId],
  );
  const teams = rows.map((r) => ({ teamNumber: r.team_number, name: r.display_name, total: Number(r.total), activeAwards: Number(r.active_awards) }));
  // 공동 순위(1,1,3 방식)
  const sorted = [...teams].sort((a, b) => b.total - a.total);
  return teams.map((t) => ({ ...t, rank: 1 + sorted.filter((s) => s.total > t.total).length }));
}

export interface LogFilter { team?: number; category?: string; actor?: string; status?: 'active' | 'cancelled'; limit?: number; offset?: number }

export async function getLog(db: Db, eventId: string, f: LogFilter = {}) {
  const where = ['a.event_id=$1'];
  const params: unknown[] = [eventId];
  if (f.team) { params.push(f.team); where.push(`a.team_number=$${params.length}`); }
  if (f.category) { params.push(f.category); where.push(`a.category_key=$${params.length}`); }
  if (f.actor) { params.push(f.actor); where.push(`(a.actor_id::text=$${params.length} OR r.actor_id::text=$${params.length})`); }
  if (f.status === 'active') where.push('r.id IS NULL');
  if (f.status === 'cancelled') where.push('r.id IS NOT NULL');
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 1000);
  params.push(limit, f.offset ?? 0);
  const { rows } = await db.query(
    `SELECT a.id, a.team_number, a.category_key, c.label AS category_label, a.subtype_key, s.label AS subtype_label,
            a.points, a.reason, a.actor_id, a.actor_name, a.created_at,
            r.id AS reversal_id, r.points AS reversal_points, r.reason AS reversal_reason,
            r.actor_id AS reversal_actor_id, r.actor_name AS reversal_actor_name, r.created_at AS reversed_at
     FROM score_awards a
     JOIN score_categories c ON c.event_id=a.event_id AND c.key=a.category_key
     LEFT JOIN score_subtypes s ON s.event_id=a.event_id AND s.category_key=a.category_key AND s.key=a.subtype_key
     LEFT JOIN score_reversals r ON r.award_id=a.id
     WHERE ${where.join(' AND ')}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows.map((r) => ({
    id: r.id, teamNumber: r.team_number, categoryKey: r.category_key, categoryLabel: r.category_label,
    subtypeKey: r.subtype_key, subtypeLabel: r.subtype_label, points: r.points, reason: r.reason,
    actorId: r.actor_id, actorName: r.actor_name, createdAt: r.created_at,
    status: r.reversal_id ? 'cancelled' : 'active',
    reversal: r.reversal_id ? { id: r.reversal_id, points: r.reversal_points, reason: r.reversal_reason, actorId: r.reversal_actor_id, actorName: r.reversal_actor_name, createdAt: r.reversed_at } : null,
  }));
}
