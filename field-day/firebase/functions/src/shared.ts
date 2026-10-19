// 서버(PostgreSQL 버전)와 같은 규칙의 순수 함수들 — Cloud Functions 배포 패키지 안에 있어야 해서 따로 둔다
import { createHmac, randomInt, scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';

export const LOGIN_FAILED_MESSAGE = '이름과 사번을 확인해 주세요. 계속 안 되면 운영진에게 문의해 주세요.';

export const normalizeName = (v: unknown) => (typeof v === 'string' ? v.normalize('NFC').trim() : '');
export const normalizeEmployeeId = (v: unknown) => (typeof v === 'string' ? v.normalize('NFC').trim() : '');
export const hmac = (secret: string, value: string) => createHmac('sha256', secret).update(value).digest('base64url');

export function maskEmployeeId(id: string): string {
  if (id.length <= 2) return '*'.repeat(id.length);
  const keep = Math.min(2, Math.floor(id.length / 3));
  return id.slice(0, keep) + '*'.repeat(id.length - keep * 2) + id.slice(id.length - keep);
}

export function secureShuffle(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = n - 1; i > 0; i--) { const j = randomInt(0, i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function hashPassword(password: string, salt = randomBytes(16)): string {
  const N = 16384;
  return `scrypt$${N}$${salt.toString('base64')}$${scryptSync(password, salt, 32, { N, r: 8, p: 1 }).toString('base64')}`;
}
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const expected = Buffer.from(parts[3], 'base64');
  const actual = scryptSync(password, Buffer.from(parts[2], 'base64'), expected.length, { N: Number(parts[1]), r: 8, p: 1 });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
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
  employee_id: 'employee_id', 사번: 'employee_id', 직원번호: 'employee_id', name: 'name', 이름: 'name', 성명: 'name',
  team_number: 'team_number', team: 'team_number', 조: 'team_number', role: 'role', 역할: 'role', 권한: 'role', active: 'active', 활성: 'active', 활성여부: 'active',
};
const ACTIVE: Record<string, boolean> = { true: true, '1': true, y: true, yes: true, 활성: true, o: true, false: false, '0': false, n: false, no: false, 비활성: false, x: false };
const ROLE: Record<string, Role> = { participant: 'participant', 참가자: 'participant', admin: 'admin', 관리자: 'admin', owner: 'owner', 총괄: 'owner' };

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
    const teamRaw = cell('team_number').trim().replace(/조$/, '');
    const roleRaw = cell('role').trim().toLowerCase();
    const activeRaw = cell('active').trim().toLowerCase();
    const reasons: string[] = [];
    if (!employeeId) reasons.push('사번이 비어 있습니다'); else if (employeeId.length > 64 || employeeId.includes('/')) reasons.push('사번 형식이 올바르지 않습니다');
    if (!name) reasons.push('이름이 비어 있습니다'); else if (name.length > 64) reasons.push('이름이 너무 깁니다');
    const teamNumber = /^[1-8]$/.test(teamRaw) ? Number(teamRaw) : NaN;
    if (Number.isNaN(teamNumber)) reasons.push(`조는 1~8이어야 합니다 (입력: "${teamRaw}")`);
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

export const toCsv = (header: string[], rows: unknown[][]) => {
  const cell = (v: unknown) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
};
