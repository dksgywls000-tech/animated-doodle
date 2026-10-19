import { createHmac, randomBytes, createHash } from 'node:crypto';

/** 업무 오류 — 사용자에게 보여도 되는 문구만 담는다 */
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export const LOGIN_FAILED_MESSAGE = '이름과 사번을 확인해 주세요. 계속 안 되면 운영진에게 문의해 주세요.';

/** 이름: 앞뒤 공백 제거 + NFC. 내부 공백은 그대로 둔다 */
export function normalizeName(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.normalize('NFC').trim();
}

/** 사번: 앞뒤 공백 제거 + NFC. 문자열 그대로 정확히 비교(대소문자 구분, 앞자리 0 보존) */
export function normalizeEmployeeId(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.normalize('NFC').trim();
}

export function maskEmployeeId(id: string): string {
  if (id.length <= 2) return '*'.repeat(id.length);
  const keep = Math.min(2, Math.floor(id.length / 3));
  return id.slice(0, keep) + '*'.repeat(id.length - keep * 2) + id.slice(id.length - keep);
}

export function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function formatTicket(n: number): string {
  return String(n).padStart(3, '0');
}

/** Asia/Seoul 기준 날짜(YYYY-MM-DD)와 분(0~1439) */
export function seoulNow(date = new Date()): { date: string; minutes: number; iso: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')), iso: date.toISOString() };
}

export function formatSeoul(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(date);
}

export function hhmmToMinutes(s: string | null): number | null {
  if (!s) return null;
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

// ── CSV ─────────────────────────────────────────────

/** RFC 4180 CSV 파서 (BOM, CRLF, 따옴표 이스케이프 지원). 각 행에 원본 줄 번호 포함 */
export function parseCsv(text: string): { line: number; cells: string[] }[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let line = 1;
  let rowStart = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '') inQuotes = true;
    else if (ch === ',') { cells.push(cell); cell = ''; }
    else if (ch === '\r') { /* CRLF — \n에서 처리 */ }
    else if (ch === '\n') {
      cells.push(cell); rows.push({ line: rowStart, cells }); cells = []; cell = ''; line++; rowStart = line;
    } else cell += ch;
  }
  if (cell !== '' || cells.length) { cells.push(cell); rows.push({ line: rowStart, cells }); }
  return rows.filter((r) => r.cells.some((c) => c.trim() !== ''));
}

/** CSV 셀 출력 — 수식 주입 방지 포함 */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
