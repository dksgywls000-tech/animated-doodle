import type { Db } from '../db.js';
import { hhmmToMinutes, seoulNow } from '../util.js';

export async function getEvent(db: Db, eventId: string) {
  const { rows } = await db.query(`SELECT * FROM events WHERE id=$1`, [eventId]);
  return rows[0];
}

/** 참가자 공개용 행사 정보 — 미공개 항목은 값 자체를 보내지 않는다 */
export function publicEventInfo(ev: any) {
  return {
    title: ev.title,
    date: toDateStr(ev.event_date),
    venue: ev.venue,
    departureNote: ev.departure_note,
    parking: ev.parking_published ? ev.parking_note : null,
    returnBus: ev.return_bus_published && ev.return_bus_note ? ev.return_bus_note : null,
    statusNote: ev.status_note || null,
    statusNoteUpdatedAt: ev.status_note_updated_at,
    schedulePublished: ev.schedule_published,
  };
}

export function toDateStr(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  // pg는 date를 로컬 자정 Date로 준다 → 로컬 기준 문자열
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface ScheduleItem {
  id: string; sortOrder: number; startTime: string | null; endTime: string | null; title: string; note: string;
  kind: string; gameKey: string | null; status: string; delayNote: string; public: boolean; updatedAt: string;
}

function mapItem(r: any): ScheduleItem {
  return {
    id: r.id, sortOrder: r.sort_order, startTime: r.start_time, endTime: r.end_time, title: r.title, note: r.note,
    kind: r.kind, gameKey: r.game_key, status: r.status, delayNote: r.delay_note, public: r.public, updatedAt: r.updated_at,
  };
}

/**
 * 현재/다음 계산.
 * 1) 운영자가 '진행 중'으로 지정한 항목이 있으면 그것이 현재(확정).
 * 2) 없으면 행사 당일 한국시간 기준 예정 시각으로 추정(basis='time') — 확정 상태는 바꾸지 않는다.
 */
export function computeNowNext(items: ScheduleItem[], eventDate: string, now = new Date()) {
  const kst = seoulNow(now);
  const live = items.filter((i) => i.status === 'live');
  let currentIds: string[] = [];
  let basis: 'manual' | 'time' | 'none' = 'none';
  let anchorOrder = -Infinity;
  if (live.length) {
    currentIds = live.map((i) => i.id);
    basis = 'manual';
    anchorOrder = Math.max(...live.map((i) => i.sortOrder));
  } else if (kst.date === eventDate) {
    const cur = items.filter((i) => {
      const s = hhmmToMinutes(i.startTime); const e = hhmmToMinutes(i.endTime);
      return i.status !== 'done' && i.status !== 'time_tbd' && s !== null && e !== null && s <= kst.minutes && kst.minutes < e;
    });
    if (cur.length) { currentIds = cur.map((i) => i.id); basis = 'time'; anchorOrder = Math.max(...cur.map((i) => i.sortOrder)); }
    else {
      // 진행 중 항목이 없으면 지금 시각 이전에 시작한 마지막 항목 뒤부터
      const started = items.filter((i) => { const s = hhmmToMinutes(i.startTime); return s !== null && s <= kst.minutes; });
      if (started.length) anchorOrder = Math.max(...started.map((i) => i.sortOrder));
      basis = 'time';
    }
  }
  const next = items.find((i) => i.sortOrder > anchorOrder && !currentIds.includes(i.id) && i.status !== 'done');
  const isEventDay = kst.date === eventDate;
  const beforeEvent = kst.date < eventDate;
  return {
    currentIds,
    nextId: (isEventDay || basis === 'manual') ? next?.id ?? null : beforeEvent ? items.find((i) => i.status !== 'done')?.id ?? null : null,
    basis, serverTime: kst.iso, isEventDay, beforeEvent,
  };
}

export async function getSchedule(db: Db, eventId: string, includeHidden = false) {
  const { rows } = await db.query(
    `SELECT * FROM schedule_items WHERE event_id=$1 ${includeHidden ? '' : 'AND public'} ORDER BY sort_order, start_time NULLS LAST`,
    [eventId],
  );
  return rows.map(mapItem);
}

export async function getGames(db: Db, eventId: string, includeUnpublished = false) {
  const { rows } = await db.query(
    `SELECT key, number, title, players, summary, how_to, bracket, bracket_note, image, pending_note, published, updated_at
     FROM game_info WHERE event_id=$1 ${includeUnpublished ? '' : 'AND published'} ORDER BY number`,
    [eventId],
  );
  return rows.map((r) => ({
    key: r.key, number: r.number, title: r.title, players: r.players, summary: r.summary, howTo: r.how_to,
    bracket: r.bracket, bracketNote: r.bracket_note, image: r.image, pendingNote: r.pending_note, published: r.published, updatedAt: r.updated_at,
  }));
}

export async function getAnnouncements(db: Db, eventId: string, viewerId: string, includeUnpublished = false) {
  const { rows } = await db.query(
    `SELECT a.id, a.title, a.body, a.important, a.published, a.created_at, a.updated_at,
            (r.participant_id IS NOT NULL) AS read
     FROM announcements a LEFT JOIN announcement_reads r ON r.announcement_id=a.id AND r.participant_id=$2
     WHERE a.event_id=$1 ${includeUnpublished ? '' : 'AND a.published'}
     ORDER BY a.important DESC, a.created_at DESC LIMIT 100`,
    [eventId, viewerId],
  );
  return rows.map((r) => ({ id: r.id, title: r.title, body: r.body, important: r.important, published: r.published, createdAt: r.created_at, updatedAt: r.updated_at, read: r.read }));
}
