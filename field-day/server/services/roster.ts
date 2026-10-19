import type { Db, Tx } from '../db.js';
import { withTx } from '../db.js';
import { AppError, normalizeEmployeeId, normalizeName, parseCsv } from '../util.js';
import type { Role } from './auth.js';

/**
 * 명단 업로드 정책
 * - 키: 사번(정확히 일치). 새 사번은 추가, 기존 사번은 이름·활성 갱신.
 * - 파일에 없는 기존 행은 그대로 둔다(삭제하지 않음). 비활성화는 active=false로 명시.
 * - 역할 변경은 별도 확인(confirmRoleChanges) 필요.
 * - 체크인한 사람의 조 변경은 업로드로 불가 → owner의 '조 예외 변경' 기능 사용.
 * - 오류 행이 하나라도 있으면 전체 반영 중단.
 * - 체크인·행운권·점수·채팅 기록은 업로드로 변경되지 않는다.
 */

const HEADER_ALIASES: Record<string, string> = {
  employee_id: 'employee_id', 사번: 'employee_id', 직원번호: 'employee_id',
  name: 'name', 이름: 'name', 성명: 'name',
  team_number: 'team_number', team: 'team_number', 조: 'team_number',
  role: 'role', 역할: 'role', 권한: 'role',
  active: 'active', 활성: 'active', 활성여부: 'active',
};

const ACTIVE_VALUES: Record<string, boolean> = {
  true: true, '1': true, y: true, yes: true, 활성: true, o: true,
  false: false, '0': false, n: false, no: false, 비활성: false, x: false,
};

const ROLE_VALUES: Record<string, Role> = {
  participant: 'participant', 참가자: 'participant', admin: 'admin', 관리자: 'admin', owner: 'owner', 총괄: 'owner',
};

export interface RosterRow { line: number; employeeId: string; name: string; teamNumber: number; role: Role; active: boolean }
export interface RosterError { line: number; reason: string }

export function parseRoster(text: string): { rows: RosterRow[]; errors: RosterError[] } {
  const raw = parseCsv(text);
  const errors: RosterError[] = [];
  if (!raw.length) return { rows: [], errors: [{ line: 1, reason: '빈 파일입니다.' }] };
  const header = raw[0].cells.map((h) => HEADER_ALIASES[h.normalize('NFC').trim().toLowerCase()] ?? HEADER_ALIASES[h.trim()] ?? '');
  for (const need of ['employee_id', 'name', 'team_number']) {
    if (!header.includes(need)) errors.push({ line: raw[0].line, reason: `필수 열이 없습니다: ${need}` });
  }
  if (errors.length) return { rows: [], errors };
  const idx = (k: string) => header.indexOf(k);
  const rows: RosterRow[] = [];
  const seen = new Map<string, number>();
  const seenLower = new Map<string, number>();
  for (const r of raw.slice(1)) {
    const cell = (k: string) => (idx(k) >= 0 ? (r.cells[idx(k)] ?? '') : '');
    const employeeId = normalizeEmployeeId(cell('employee_id'));
    const name = normalizeName(cell('name'));
    const teamRaw = cell('team_number').trim().replace(/조$/, '');
    const roleRaw = cell('role').trim().toLowerCase();
    const activeRaw = cell('active').trim().toLowerCase();
    const reasons: string[] = [];
    if (!employeeId) reasons.push('사번이 비어 있습니다');
    else if (employeeId.length > 64) reasons.push('사번이 너무 깁니다');
    if (!name) reasons.push('이름이 비어 있습니다');
    else if (name.length > 64) reasons.push('이름이 너무 깁니다');
    const teamNumber = /^[1-8]$/.test(teamRaw) ? Number(teamRaw) : NaN;
    if (Number.isNaN(teamNumber)) reasons.push(`조는 1~8이어야 합니다 (입력: "${teamRaw}")`);
    const role = roleRaw === '' ? 'participant' : ROLE_VALUES[roleRaw];
    if (!role) reasons.push(`역할은 participant/admin/owner 중 하나여야 합니다 (입력: "${roleRaw}")`);
    const active = activeRaw === '' ? true : ACTIVE_VALUES[activeRaw];
    if (active === undefined) reasons.push(`활성값은 true/false여야 합니다 (입력: "${activeRaw}")`);
    if (employeeId) {
      if (seen.has(employeeId)) reasons.push(`사번 중복 (${seen.get(employeeId)}행과 같음)`);
      else if (seenLower.has(employeeId.toLowerCase())) reasons.push(`대소문자만 다른 사번 중복 (${seenLower.get(employeeId.toLowerCase())}행)`);
      seen.set(employeeId, r.line);
      seenLower.set(employeeId.toLowerCase(), r.line);
    }
    if (reasons.length) errors.push({ line: r.line, reason: reasons.join(', ') });
    else rows.push({ line: r.line, employeeId, name, teamNumber, role: role!, active: active! });
  }
  if (!rows.length && !errors.length) errors.push({ line: 1, reason: '데이터 행이 없습니다.' });
  return { rows, errors };
}

export interface RosterPlan {
  inserts: RosterRow[];
  updates: { row: RosterRow; changes: string[] }[];
  roleChanges: { line: number; name: string; from: Role; to: Role }[];
  unchanged: number;
  untouchedExisting: number;
  errors: RosterError[];
}

async function plan(tx: Tx | Db, eventId: string, actorId: string | null, text: string): Promise<RosterPlan & { existing: Map<string, any> }> {
  const { rows, errors } = parseRoster(text);
  const ex = await tx.query(
    `SELECT p.id, p.employee_id, p.name, p.team_number, p.role, p.active, (c.participant_id IS NOT NULL) AS checked_in
     FROM participants p LEFT JOIN checkins c ON c.participant_id=p.id AND c.event_id=p.event_id WHERE p.event_id=$1`,
    [eventId],
  );
  const existing = new Map(ex.rows.map((r) => [r.employee_id, r]));
  const existingLower = new Map(ex.rows.map((r) => [String(r.employee_id).toLowerCase(), r]));
  const result: RosterPlan = { inserts: [], updates: [], roleChanges: [], unchanged: 0, untouchedExisting: 0, errors: [...errors] };
  const touched = new Set<string>();
  for (const row of rows) {
    const cur = existing.get(row.employeeId);
    if (!cur) {
      const ci = existingLower.get(row.employeeId.toLowerCase());
      if (ci) { result.errors.push({ line: row.line, reason: `기존 사번과 대소문자만 다릅니다` }); continue; }
      result.inserts.push(row);
      continue;
    }
    touched.add(cur.id);
    const changes: string[] = [];
    if (cur.name !== row.name) changes.push('이름');
    if (cur.active !== row.active) changes.push(row.active ? '활성화' : '비활성화');
    if (cur.team_number !== row.teamNumber) {
      if (cur.checked_in) {
        result.errors.push({ line: row.line, reason: `체크인한 참가자의 조 변경(${cur.team_number}→${row.teamNumber}조)은 업로드로 할 수 없습니다. 관리자 화면의 '조 예외 변경'을 사용하세요` });
        continue;
      }
      changes.push(`조 ${cur.team_number}→${row.teamNumber}`);
    }
    if (cur.role !== row.role) {
      if (actorId && cur.id === actorId) {
        result.errors.push({ line: row.line, reason: '본인의 역할은 업로드로 바꿀 수 없습니다' });
        continue;
      }
      result.roleChanges.push({ line: row.line, name: row.name, from: cur.role, to: row.role });
      changes.push(`역할 ${cur.role}→${row.role}`);
    }
    if (actorId && cur.id === actorId && !row.active) {
      result.errors.push({ line: row.line, reason: '본인을 비활성화할 수 없습니다' });
      continue;
    }
    if (changes.length) result.updates.push({ row, changes }); else result.unchanged++;
  }
  result.untouchedExisting = ex.rows.filter((r) => !touched.has(r.id)).length;
  // 마지막 owner 보호
  const finalOwners = new Set(ex.rows.filter((r) => r.role === 'owner' && r.active).map((r) => r.employee_id));
  for (const u of result.updates) {
    if (u.row.role === 'owner' && u.row.active) finalOwners.add(u.row.employeeId); else finalOwners.delete(u.row.employeeId);
  }
  for (const i of result.inserts) if (i.role === 'owner' && i.active) finalOwners.add(i.employeeId);
  if (finalOwners.size === 0) result.errors.push({ line: 0, reason: '활성 owner가 한 명 이상 남아야 합니다' });
  result.errors.sort((a, b) => a.line - b.line);
  return { ...result, existing };
}

export async function previewRoster(db: Db, eventId: string, actorId: string | null, text: string): Promise<RosterPlan> {
  const { existing: _e, ...p } = await plan(db, eventId, actorId, text);
  return p;
}

export async function commitRoster(
  db: Db, eventId: string, actor: { id: string | null; name: string | null }, text: string, confirmRoleChanges: boolean,
): Promise<{ plan: RosterPlan; affected: string[] }> {
  return withTx(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['roster:' + eventId]);
    const p = await plan(tx, eventId, actor.id, text);
    if (p.errors.length) throw new AppError(422, 'roster_invalid', '오류가 있는 행이 있어 전체 반영을 중단했습니다.', { errors: p.errors });
    if (p.roleChanges.length && !confirmRoleChanges) {
      throw new AppError(409, 'role_change_confirmation', '역할 변경이 포함되어 있습니다. 변경 내용을 확인한 뒤 다시 반영해 주세요.', { roleChanges: p.roleChanges });
    }
    const affected: string[] = [];
    for (const r of p.inserts) {
      await tx.query(
        `INSERT INTO participants (event_id, employee_id, name, team_number, role, active) VALUES ($1,$2,$3,$4,$5,$6)`,
        [eventId, r.employeeId, r.name, r.teamNumber, r.role, r.active],
      );
    }
    for (const u of p.updates) {
      const cur = p.existing.get(u.row.employeeId);
      await tx.query(
        `UPDATE participants SET name=$2, team_number=$3, role=$4, active=$5, updated_at=now() WHERE id=$1`,
        [cur.id, u.row.name, u.row.teamNumber, u.row.role, u.row.active],
      );
      if (!u.row.active) await tx.query(`UPDATE sessions SET revoked_at=now() WHERE participant_id=$1 AND revoked_at IS NULL`, [cur.id]);
      affected.push(cur.id);
    }
    const { existing: _e, ...publicPlan } = p;
    await tx.query(
      `INSERT INTO audit_events (event_id, actor_id, actor_name, action, detail) VALUES ($1,$2,$3,'roster_import',$4)`,
      [eventId, actor.id, actor.name ?? 'CLI', JSON.stringify({
        inserted: p.inserts.length, updated: p.updates.length, unchanged: p.unchanged,
        roleChanges: p.roleChanges.map((r) => ({ line: r.line, from: r.from, to: r.to })),
      })],
    );
    return { plan: publicPlan, affected };
  });
}

export async function setRole(db: Db, eventId: string, actor: { id: string; name: string }, participantId: string, role: unknown) {
  if (role !== 'participant' && role !== 'admin' && role !== 'owner') throw new AppError(400, 'invalid_role', '역할 값이 올바르지 않습니다.');
  if (participantId === actor.id) throw new AppError(400, 'self_role', '본인의 역할은 바꿀 수 없습니다. 다른 owner에게 요청해 주세요.');
  return withTx(db, async (tx) => {
    const cur = await tx.query(`SELECT id, role, name FROM participants WHERE id=$1 AND event_id=$2 FOR UPDATE`, [participantId, eventId]);
    if (!cur.rows[0]) throw new AppError(404, 'not_found', '참가자를 찾을 수 없습니다.');
    if (cur.rows[0].role === 'owner' && role !== 'owner') {
      const owners = await tx.query(`SELECT count(*) AS n FROM participants WHERE event_id=$1 AND role='owner' AND active`, [eventId]);
      if (Number(owners.rows[0].n) <= 1) throw new AppError(400, 'last_owner', '마지막 owner는 해제할 수 없습니다.');
    }
    await tx.query(`UPDATE participants SET role=$2, updated_at=now() WHERE id=$1`, [participantId, role]);
    await tx.query(
      `INSERT INTO audit_events (event_id, actor_id, actor_name, action, target, detail) VALUES ($1,$2,$3,'role_change',$4,$5)`,
      [eventId, actor.id, actor.name, participantId, JSON.stringify({ name: cur.rows[0].name, from: cur.rows[0].role, to: role })],
    );
    return { from: cur.rows[0].role, to: role };
  });
}

export async function changeTeam(db: Db, eventId: string, actor: { id: string; name: string }, participantId: string, teamNumber: unknown, reason: unknown) {
  if (typeof teamNumber !== 'number' || !Number.isInteger(teamNumber) || teamNumber < 1 || teamNumber > 8) throw new AppError(400, 'invalid_team', '1~8조 중에서 선택해 주세요.');
  const r = typeof reason === 'string' ? reason.trim() : '';
  if (r.length < 2 || r.length > 200) throw new AppError(400, 'invalid_reason', '조 변경 사유를 입력해 주세요.');
  return withTx(db, async (tx) => {
    const cur = await tx.query(`SELECT id, team_number, name FROM participants WHERE id=$1 AND event_id=$2 FOR UPDATE`, [participantId, eventId]);
    if (!cur.rows[0]) throw new AppError(404, 'not_found', '참가자를 찾을 수 없습니다.');
    if (cur.rows[0].team_number === teamNumber) throw new AppError(400, 'same_team', '이미 같은 조입니다.');
    await tx.query(`UPDATE participants SET team_number=$2, updated_at=now() WHERE id=$1`, [participantId, teamNumber]);
    await tx.query(
      `INSERT INTO audit_events (event_id, actor_id, actor_name, action, target, detail) VALUES ($1,$2,$3,'team_change',$4,$5)`,
      [eventId, actor.id, actor.name, participantId, JSON.stringify({ name: cur.rows[0].name, from: cur.rows[0].team_number, to: teamNumber, reason: r })],
    );
    return { from: cur.rows[0].team_number, to: teamNumber };
  });
}
