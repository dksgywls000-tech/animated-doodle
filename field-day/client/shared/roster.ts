// 명단 CSV 파서 — Cloud Functions 버전(firebase/functions/src/shared.ts)과 같은 규칙을 브라우저에서 사용
export const normalizeName = (v: unknown) => (typeof v === 'string' ? v.normalize('NFC').trim() : '');
export const normalizeEmployeeId = (v: unknown) => (typeof v === 'string' ? v.normalize('NFC').trim() : '');

/** SHA-256 16진수 (브라우저 내장 암호화) */
export async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
/** 로그인 키: 사번과 이름을 함께 해시 — 둘 다 알아야만 찾을 수 있다 */
export const loginKey = (employeeId: string, name: string) => sha256hex(`fd26|${normalizeEmployeeId(employeeId)}|${normalizeName(name)}`);
export const empKey = (employeeId: string) => sha256hex(`fd26emp|${normalizeEmployeeId(employeeId).toLowerCase()}`);

/** 보안 난수 셔플 */
export function secureShuffle(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = n - 1; i > 0; i--) {
    const r = new Uint32Array(1); crypto.getRandomValues(r);
    const j = r[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── CSV 명단 ──
export type Role = 'participant' | 'admin' | 'owner';
export interface RosterRow { line: number; employeeId: string; name: string; teamNumber: number; role: Role; active: boolean }

export function parseCsv(text: string): { line: number; cells: string[] }[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = []; let cell = ''; let q = false; let line = 1; let start = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else { if (ch === '\n') line++; cell += ch; } continue; }
    if (ch === '"' && cell === '') q = true;
    else if (ch === ',') { cells.push(cell); cell = ''; }
    else if (ch === '\r') { /* skip */ }
    else if (ch === '\n') { cells.push(cell); rows.push({ line: start, cells }); cells = []; cell = ''; line++; start = line; }
    else cell += ch;
  }
  if (cell !== '' || cells.length) { cells.push(cell); rows.push({ line: start, cells }); }
  return rows.filter((r) => r.cells.some((c) => c.trim() !== ''));
}

const HEADER: Record<string, string> = {
  employee_id: 'employee_id', 사번: 'employee_id', 직원번호: 'employee_id', name: 'name', 이름: 'name', 성명: 'name', 직원명: 'name',
  team_number: 'team_number', team: 'team_number', 조: 'team_number', 소속: 'team_number', 조편성: 'team_number', role: 'role', 역할: 'role', 권한: 'role', 직급: 'role', active: 'active', 활성: 'active', 활성여부: 'active',
};
const ACTIVE: Record<string, boolean> = { true: true, '1': true, y: true, yes: true, 활성: true, o: true, false: false, '0': false, n: false, no: false, 비활성: false, x: false };
const ROLE: Record<string, Role> = { participant: 'participant', 참가자: 'participant', 일반: 'participant', 팀장: 'participant', 조장: 'participant', admin: 'admin', 관리자: 'admin', owner: 'owner', 총괄: 'owner' };

/** '3', '3조' → 3, '운영진'·'0' → 0, 그 밖은 NaN */
export function parseTeam(v: unknown): number {
  const t = String(v ?? '').trim();
  if (t === '운영진' || t === '운영' || t === '0') return 0;
  const m = /^([1-8])\s*조?$/.exec(t);
  return m ? Number(m[1]) : NaN;
}
export const isTeam = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 8;

export function parseRoster(text: string): { rows: RosterRow[]; errors: { line: number; reason: string }[] } {
  const raw = parseCsv(text);
  const errors: { line: number; reason: string }[] = [];
  if (!raw.length) return { rows: [], errors: [{ line: 1, reason: '빈 파일입니다.' }] };
  const header = raw[0].cells.map((h) => HEADER[h.normalize('NFC').trim().toLowerCase()] ?? '');
  for (const need of ['employee_id', 'name', 'team_number']) if (!header.includes(need)) errors.push({ line: raw[0].line, reason: `필수 열이 없습니다: ${need}` });
  if (errors.length) return { rows: [], errors };
  const rows: RosterRow[] = [];
  const seen = new Map<string, number>();
  for (const r of raw.slice(1)) {
    const cell = (k: string) => (header.indexOf(k) >= 0 ? r.cells[header.indexOf(k)] ?? '' : '');
    const employeeId = normalizeEmployeeId(cell('employee_id'));
    const name = normalizeName(cell('name'));
    const teamRaw = cell('team_number').trim();
    const roleRaw = cell('role').trim().toLowerCase();
    const activeRaw = cell('active').trim().toLowerCase();
    const reasons: string[] = [];
    if (!employeeId) reasons.push('사번이 비어 있습니다'); else if (employeeId.length > 64 || employeeId.includes('/')) reasons.push('사번 형식이 올바르지 않습니다');
    if (!name) reasons.push('이름이 비어 있습니다'); else if (name.length > 64) reasons.push('이름이 너무 깁니다');
    const teamNumber = parseTeam(teamRaw);
    if (Number.isNaN(teamNumber)) reasons.push(`조는 1~8 또는 운영진이어야 합니다 (입력: "${teamRaw}")`);
    const role = roleRaw === '' ? 'participant' : ROLE[roleRaw];
    if (!role) reasons.push(`역할은 participant/admin/owner 중 하나여야 합니다 (입력: "${roleRaw}")`);
    const active = activeRaw === '' ? true : ACTIVE[activeRaw];
    if (active === undefined) reasons.push(`활성값은 true/false여야 합니다 (입력: "${activeRaw}")`);
    if (employeeId) {
      const k = employeeId.toLowerCase();
      if (seen.has(k)) reasons.push(`사번 중복 (${seen.get(k)}행과 같거나 대소문자만 다름)`);
      seen.set(k, r.line);
    }
    if (reasons.length) errors.push({ line: r.line, reason: reasons.join(', ') });
    else rows.push({ line: r.line, employeeId, name, teamNumber, role: role!, active: active! });
  }
  if (!rows.length && !errors.length) errors.push({ line: 1, reason: '데이터 행이 없습니다.' });
  return { rows, errors };
}

