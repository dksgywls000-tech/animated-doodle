export const formatTicket = (n: number | null | undefined) => (n == null ? '---' : String(n).padStart(3, '0'));

export function uid(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

const kstTime = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const kstDate = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' });
const kstFull = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const kstKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });

export const fmtTime = (iso: string | Date) => kstTime.format(new Date(iso));
export const fmtDate = (iso: string | Date) => kstDate.format(new Date(iso));
export const fmtFull = (iso: string | Date) => kstFull.format(new Date(iso));
export const dayKey = (iso: string | Date) => kstKey.format(new Date(iso));

export const timeRange = (s: string | null, e: string | null) => (s ? (e ? `${s}–${e}` : s) : '시간 미정');

export function cx(...c: (string | false | null | undefined)[]) { return c.filter(Boolean).join(' '); }

/** 0 = 운영진 */
export const teamLabel = (n: number) => (n === 0 ? '운영진' : `${n}조`);

export const TEAM_COLORS: Record<number, string> = {
  0: '#17261E',
  1: '#D9443A', 2: '#F08A24', 3: '#E3C21B', 4: '#3E9B4F', 5: '#2C7FB8', 6: '#3A4DA8', 7: '#8150B5', 8: '#4A5258',
};

/** 좌석 배치도(04) 위 각 조 표시 박스의 위치(원본 이미지 기준 %) */
export const SEAT_SPOTS: Record<number, [number, number]> = {
  0: [44.4, 82],
  1: [29.4, 82], 2: [29.4, 74.4], 3: [38.6, 73.5], 4: [49.5, 73.8], 5: [60, 70.2], 6: [69.6, 70.2], 7: [60, 78.1], 8: [69.6, 78.1],
};
