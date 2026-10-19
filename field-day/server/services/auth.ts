import type { Db } from '../db.js';
import type { Config } from '../config.js';
import { AppError, LOGIN_FAILED_MESSAGE, hmac, normalizeEmployeeId, normalizeName, randomToken, sha256 } from '../util.js';
import { ensureCheckin } from './checkin.js';

export type Role = 'participant' | 'admin' | 'owner';

export interface SessionUser {
  participantId: string;
  sessionHash: string;
  csrfToken: string;
  name: string;
  employeeId: string;
  teamNumber: number;
  role: Role;
}

export const isStaff = (r: Role) => r === 'admin' || r === 'owner';

const LIMITS = {
  pairWindowMin: 10, pairMax: 5,          // 같은 IP + 같은 사번 후보
  accountWindowMin: 15, accountMax: 15,   // 같은 사번 후보(모든 IP)
  ipWindowMin: 10, ipMax: 120,            // 같은 IP 전체 — 행사장 공용 Wi-Fi를 고려해 넉넉하게
};

export async function checkLoginRateLimit(db: Db, ipKey: string, accountKey: string): Promise<void> {
  const { rows } = await db.query<{ pair: string; account: string; ip: string }>(
    `SELECT
       count(*) FILTER (WHERE ip_key=$1 AND account_key=$2 AND created_at > now() - make_interval(mins => $3)) AS pair,
       count(*) FILTER (WHERE account_key=$2 AND created_at > now() - make_interval(mins => $4)) AS account,
       count(*) FILTER (WHERE ip_key=$1 AND created_at > now() - make_interval(mins => $5)) AS ip
     FROM login_attempts WHERE success = false AND (ip_key=$1 OR account_key=$2)
       AND created_at > now() - interval '15 minutes'`,
    [ipKey, accountKey, LIMITS.pairWindowMin, LIMITS.accountWindowMin, LIMITS.ipWindowMin],
  );
  const r = rows[0];
  let waitMin = 0;
  if (Number(r.pair) >= LIMITS.pairMax) waitMin = LIMITS.pairWindowMin;
  if (Number(r.account) >= LIMITS.accountMax) waitMin = LIMITS.accountWindowMin;
  if (Number(r.ip) >= LIMITS.ipMax) waitMin = Math.max(waitMin, LIMITS.ipWindowMin);
  if (waitMin) {
    throw new AppError(429, 'rate_limited', `입력 시도가 많아 잠시 제한되었습니다. 약 ${waitMin}분 후 다시 시도하거나 운영진에게 문의해 주세요.`);
  }
}

export async function login(
  db: Db, config: Config, input: { name?: unknown; employeeId?: unknown }, ip: string,
): Promise<{ token: string; user: SessionUser; ticketNumber: number; isNewCheckin: boolean }> {
  const name = normalizeName(input.name);
  const employeeId = normalizeEmployeeId(input.employeeId);
  if (!name || !employeeId || name.length > 64 || employeeId.length > 64) {
    throw new AppError(400, 'login_failed', LOGIN_FAILED_MESSAGE);
  }
  const accountKey = hmac(config.rateLimitSecret, 'acct:' + employeeId.toLowerCase());
  const ipKey = hmac(config.rateLimitSecret, 'ip:' + ip);
  await checkLoginRateLimit(db, ipKey, accountKey);

  // 반드시 같은 행의 이름+사번 조합
  const { rows } = await db.query(
    `SELECT id, name, employee_id, team_number, role, active FROM participants
     WHERE event_id=$1 AND employee_id=$2 AND name=$3`,
    [config.eventId, employeeId, name],
  );
  const p = rows[0];
  if (!p || !p.active) {
    await db.query(`INSERT INTO login_attempts (ip_key, account_key, success) VALUES ($1,$2,false)`, [ipKey, accountKey]);
    throw new AppError(401, 'login_failed', LOGIN_FAILED_MESSAGE);
  }
  const checkin = await ensureCheckin(db, config.eventId, p.id);
  const token = randomToken();
  const csrfToken = randomToken(24);
  const tokenHash = sha256(token);
  await db.query(
    `INSERT INTO sessions (token_hash, participant_id, csrf_token, expires_at)
     VALUES ($1,$2,$3, now() + make_interval(hours => $4))`,
    [tokenHash, p.id, csrfToken, config.sessionTtlHours],
  );
  await db.query(`INSERT INTO login_attempts (ip_key, account_key, success) VALUES ($1,$2,true)`, [ipKey, accountKey]);
  return {
    token,
    ticketNumber: checkin.ticketNumber,
    isNewCheckin: checkin.isNew,
    user: { participantId: p.id, sessionHash: tokenHash, csrfToken, name: p.name, employeeId: p.employee_id, teamNumber: p.team_number, role: p.role },
  };
}

/** 매 요청마다 세션+참가자 상태를 DB에서 새로 읽는다 → 역할/조/비활성 변경 즉시 반영 */
export async function loadSession(db: Db, eventId: string, token: string | undefined): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const tokenHash = sha256(token);
  const { rows } = await db.query(
    `UPDATE sessions s SET last_seen_at = now()
     FROM participants p
     WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at > now()
       AND p.id = s.participant_id AND p.event_id=$2 AND p.active
     RETURNING s.token_hash, s.csrf_token, p.id, p.name, p.employee_id, p.team_number, p.role`,
    [tokenHash, eventId],
  );
  const r = rows[0];
  if (!r) return null;
  return { participantId: r.id, sessionHash: r.token_hash, csrfToken: r.csrf_token, name: r.name, employeeId: r.employee_id, teamNumber: r.team_number, role: r.role };
}

export async function logout(db: Db, sessionHash: string): Promise<void> {
  await db.query(`UPDATE sessions SET revoked_at = now() WHERE token_hash=$1 AND revoked_at IS NULL`, [sessionHash]);
}

export async function revokeParticipantSessions(db: Db, participantId: string): Promise<void> {
  await db.query(`UPDATE sessions SET revoked_at = now() WHERE participant_id=$1 AND revoked_at IS NULL`, [participantId]);
}
