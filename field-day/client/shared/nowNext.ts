import type { ScheduleItem } from '../src/types';

const EVENT_DATE = '2026-10-21';
const hm = (t: string | null) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null);

export function seoulNow(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, minutes: Number(g('hour')) * 60 + Number(g('minute')) };
}

/** 운영자가 지정한 '진행 중'이 최우선, 없으면 행사 당일 한국시간 예정 시각으로 추정 (서버 버전과 같은 규칙) */
export function computeNowNext(items: ScheduleItem[], k = seoulNow()) {
  const live = items.filter((i) => i.status === 'live');
  let currentIds: string[] = []; let basis: 'manual' | 'time' | 'none' = 'none'; let anchor = -Infinity;
  if (live.length) { currentIds = live.map((i) => i.id); basis = 'manual'; anchor = Math.max(...live.map((i) => i.sortOrder)); }
  else if (k.date === EVENT_DATE) {
    basis = 'time';
    const cur = items.filter((i) => { const a = hm(i.startTime), b = hm(i.endTime); return i.status !== 'done' && i.status !== 'time_tbd' && a !== null && b !== null && a <= k.minutes && k.minutes < b; });
    if (cur.length) { currentIds = cur.map((i) => i.id); anchor = Math.max(...cur.map((i) => i.sortOrder)); }
    else { const st = items.filter((i) => { const a = hm(i.startTime); return a !== null && a <= k.minutes; }); if (st.length) anchor = Math.max(...st.map((i) => i.sortOrder)); }
  }
  const isEventDay = k.date === EVENT_DATE; const beforeEvent = k.date < EVENT_DATE;
  const next = items.find((i) => i.sortOrder > anchor && !currentIds.includes(i.id) && i.status !== 'done');
  return {
    currentIds, basis, serverTime: new Date().toISOString(), isEventDay, beforeEvent,
    nextId: isEventDay || basis === 'manual' ? next?.id ?? null : beforeEvent ? items.find((i) => i.status !== 'done')?.id ?? null : null,
  };
}
