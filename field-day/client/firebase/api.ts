/**
 * Firebase 백엔드 어댑터 — 실제 앱의 client/src/api.ts와 같은 함수(api, ApiError…)를 내보낸다.
 * 화면 코드는 그대로 두고 '/api/...' 요청을 Firestore 읽기·쓰기와 Cloud Functions 호출로 바꾼다.
 * 권한은 브라우저가 아니라 firestore.rules와 Cloud Functions가 검사한다.
 */
import { signInWithCustomToken, signOut } from 'firebase/auth';
import {
  collection, doc, getDoc, getDocs, query, where, orderBy, limit, startAfter, writeBatch, setDoc, updateDoc, addDoc,
  serverTimestamp, Timestamp, getCountFromServer, type DocumentSnapshot,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { FirebaseError } from 'firebase/app';
import { auth, authReady, db, fns, configMissing } from './fb';
import { CATEGORIES, EVENT_SUBTYPES, SEAT_NOTES, teamLabel } from '../../server/services/seedData';
import { computeNowNext } from '../shared/nowNext';
import type { ScheduleItem } from '../src/types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, any> = {}) { super(message); }
  get unknownOutcome() { return this.status === 0; }
}
export const setCsrf = (_t: string) => {};
export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');

const STATUS: Record<string, number> = {
  unauthenticated: 401, 'permission-denied': 403, 'invalid-argument': 400, 'not-found': 404, 'already-exists': 409,
  'resource-exhausted': 429, 'failed-precondition': 409, aborted: 409, unavailable: 0, 'deadline-exceeded': 0, internal: 500, cancelled: 0,
};
function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof FirebaseError) {
    const code = e.code.replace(/^(functions|firestore|auth)\//, '');
    const status = STATUS[code] ?? 500;
    const details = ((e as any).customData ?? (e as any).details ?? {}) as Record<string, any>;
    if (status === 0) return new ApiError(0, 'network', '네트워크 연결이 불안정합니다. 연결을 확인한 뒤 다시 시도해 주세요.');
    if (e.code.startsWith('functions/') && status !== 500) return new ApiError(status, details.code ?? code, e.message, details);
    if (status === 403) return new ApiError(403, 'forbidden', '권한이 없습니다.');
    if (status === 401) return new ApiError(401, 'unauthenticated', '로그인이 필요합니다. 이름과 사번으로 다시 입장해 주세요.');
    return new ApiError(status, code, '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  if (!navigator.onLine) return new ApiError(0, 'network', '네트워크 연결이 불안정합니다. 연결을 확인한 뒤 다시 시도해 주세요.');
  return new ApiError(500, 'error', '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
}
const fail = (status: number, code: string, message: string): never => { throw new ApiError(status, code, message); };

const call = async <T = any>(name: string, data: unknown): Promise<T> => (await httpsCallable(fns, name, { timeout: 30_000 })(data)).data as T;
const iso = (v: unknown): string | null => (v instanceof Timestamp ? v.toDate().toISOString() : typeof v === 'string' ? v : null);
const isoNow = (v: unknown) => iso(v) ?? new Date().toISOString();
const est = { serverTimestamps: 'estimate' as const };
const mask = (id: string) => (id.length <= 2 ? '**' : id.slice(0, 2) + '*'.repeat(Math.max(1, id.length - 4)) + id.slice(-2));

export const CATS = CATEGORIES.map(([key, label, kind]) => ({ key, label, kind }));
const SUBS = EVENT_SUBTYPES.map(([key, label]) => ({ key, label }));

// ── 현재 사용자 ──
interface Me { uid: string; name: string; teamNumber: number; role: 'participant' | 'admin' | 'owner'; active: boolean }
let meCache: { at: number; me: Me } | null = null;
export async function currentMe(fresh = false): Promise<Me> {
  const user = auth.currentUser ?? (await authReady);
  if (!user) fail(401, 'unauthenticated', '로그인이 필요합니다. 이름과 사번으로 다시 입장해 주세요.');
  if (!fresh && meCache && meCache.me.uid === user!.uid && Date.now() - meCache.at < 3000) return meCache.me;
  let snap: DocumentSnapshot;
  try { snap = await getDoc(doc(db, 'participants', user!.uid)); } catch (e) {
    const err = toApiError(e);
    if (err.status === 403) { await signOut(auth); fail(401, 'unauthenticated', '로그인이 필요합니다. 이름과 사번으로 다시 입장해 주세요.'); }
    throw err;
  }
  const d = snap.data();
  if (!d || !d.active) { await signOut(auth); fail(401, 'unauthenticated', '로그인이 필요합니다. 이름과 사번으로 다시 입장해 주세요.'); }
  const me = { uid: user!.uid, name: d!.name, teamNumber: d!.teamNumber, role: d!.role, active: d!.active } as Me;
  meCache = { at: Date.now(), me };
  return me;
}
const staffOnly = async (owner = false) => {
  const me = await currentMe();
  if (owner ? me.role !== 'owner' : me.role === 'participant') fail(403, 'forbidden', owner ? 'owner만 사용할 수 있습니다.' : '관리자만 사용할 수 있습니다.');
  return me;
};

async function auditLog(me: Me, action: string, target: string | null = null, detail: Record<string, unknown> = {}) {
  try { await addDoc(collection(db, 'audit'), { actorId: me.uid, actorName: me.name, action, target, detail, createdAt: serverTimestamp() }); } catch { /* 감사 실패가 화면 동작을 막지 않게 */ }
}

// ── 공용 읽기 ──
async function readEvent() {
  const s = await getDoc(doc(db, 'config', 'event'));
  const e = s.data() ?? {};
  return e as Record<string, any>;
}
const eventInfo = (e: Record<string, any>) => ({
  title: e.title ?? '2026 하이테크본부 가을운동회', date: e.date ?? '2026-10-21', venue: e.venue ?? '이충동 부락산 분수공원 야외공연장',
  departureNote: e.departureNote ?? '', parking: e.parkingPublished ? e.parkingNote : null,
  returnBus: e.returnBusPublished && e.returnBusNote ? e.returnBusNote : null,
  statusNote: e.statusNote || null, statusNoteUpdatedAt: iso(e.statusNoteUpdatedAt), schedulePublished: !!e.schedulePublished,
});
async function readSchedule(all: boolean): Promise<ScheduleItem[]> {
  const q = all ? query(collection(db, 'schedule'), orderBy('sortOrder')) : query(collection(db, 'schedule'), where('public', '==', true), orderBy('sortOrder'));
  return (await getDocs(q)).docs.map((d) => { const x = d.data(est); return { id: d.id, sortOrder: x.sortOrder, startTime: x.startTime, endTime: x.endTime, title: x.title, note: x.note, kind: x.kind ?? 'general', gameKey: null, status: x.status, delayNote: x.delayNote ?? '', public: x.public, updatedAt: isoNow(x.updatedAt) }; });
}
async function readAnnouncements(me: Me, all: boolean) {
  const q = all ? query(collection(db, 'announcements'), orderBy('createdAt', 'desc'), limit(100)) : query(collection(db, 'announcements'), where('published', '==', true), orderBy('createdAt', 'desc'), limit(100));
  const [list, reads] = await Promise.all([getDocs(q), getDoc(doc(db, 'annReads', me.uid))]);
  const ids = (reads.data()?.ids ?? {}) as Record<string, boolean>;
  return list.docs.map((d) => { const x = d.data(est); return { id: d.id, title: x.title, body: x.body, important: x.important, published: x.published, createdAt: isoNow(x.createdAt), updatedAt: isoNow(x.updatedAt), read: !!ids[d.id] }; })
    .sort((a, b) => Number(b.important) - Number(a.important) || b.createdAt.localeCompare(a.createdAt));
}

// ── 채팅 ──
export function toMessage(d: DocumentSnapshot, viewer?: string) {
  const x = d.data(est)!;
  const state = x.hiddenAt ? 'hidden' : x.deletedAt ? 'deleted' : 'ok';
  return {
    id: d.id, channel: x.channel, senderId: x.senderId, senderName: x.senderName, senderTeam: x.senderTeam, staff: x.staff,
    body: state === 'ok' ? x.body : null, state, createdAt: isoNow(x.createdAt),
    ...(viewer === x.senderId ? { clientMsgId: d.id.slice(x.senderId.length + 1) } : {}),
  };
}
function resolveChannel(me: Me, ch: string) {
  if (ch === 'all') return 'all';
  if (ch === 'team') return `team:${me.teamNumber}`;
  const m = /^team:([0-8])$/.exec(ch);
  if (m) { if (Number(m[1]) !== me.teamNumber) fail(403, 'forbidden_channel', '다른 조 채팅방에는 들어갈 수 없습니다.'); return ch; }
  return fail(400, 'invalid_channel', '채팅방을 찾을 수 없습니다.');
}

// ── 점수 ──
async function readLedger() {
  const [aw, rv] = await Promise.all([getDocs(collection(db, 'awards')), getDocs(collection(db, 'reversals'))]);
  const revs = new Map(rv.docs.map((d) => [d.id, d.data(est)]));
  return aw.docs.map((d) => {
    const a = d.data(est); const r = revs.get(d.id);
    return {
      id: d.id, teamNumber: a.teamNumber as number, categoryKey: a.categoryKey, categoryLabel: CATS.find((c) => c.key === a.categoryKey)?.label ?? a.categoryKey,
      subtypeKey: a.subtypeKey ?? null, subtypeLabel: SUBS.find((s) => s.key === a.subtypeKey)?.label ?? null, points: a.points as number, reason: a.reason,
      actorId: a.actorId, actorName: a.actorName, createdAt: isoNow(a.createdAt), status: r ? 'cancelled' : 'active',
      reversal: r ? { id: d.id, points: r.points as number, reason: r.reason, actorId: r.actorId, actorName: r.actorName, createdAt: isoNow(r.createdAt) } : null,
    };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function board() {
  const ledger = await readLedger();
  const teams = Array.from({ length: 8 }, (_, i) => {
    const t = i + 1; const mine = ledger.filter((e) => e.teamNumber === t);
    const total = mine.reduce((s, e) => s + e.points + (e.reversal?.points ?? 0), 0);
    return { teamNumber: t, name: `${t}조`, total, activeAwards: mine.filter((e) => !e.reversal).length };
  });
  return teams.map((t) => ({ ...t, rank: 1 + teams.filter((o) => o.total > t.total).length }));
}
export { readLedger };

// ─────────────────────────────────────────────────────────────
export async function api<T = any>(method: string, url: string, body?: any): Promise<T> {
  if (configMissing) throw new ApiError(503, 'not_configured', '앱 설정(Firebase 연결 정보)이 비어 있습니다. 운영자에게 문의해 주세요.');
  try {
    return (await route(method, url, body ?? {})) as T;
  } catch (e) {
    const err = toApiError(e);
    if (err.status === 401) window.dispatchEvent(new CustomEvent('fd:unauthenticated'));
    throw err;
  }
}

async function route(method: string, url: string, b: any): Promise<unknown> {
  const u = new URL(url, location.origin);
  const path = u.pathname.replace(/^\/api/, '');
  const q = u.searchParams;
  const is = (m: string, re: RegExp) => (method === m ? re.exec(path) : null);
  let m: RegExpExecArray | null;

  // ── 로그인 ──
  if (is('GET', /^\/public\/event$/)) return { title: '2026 하이테크본부 가을운동회', date: '2026-10-21', venue: '이충동 부락산 분수공원 야외공연장', demo: import.meta.env.VITE_DEMO_LABEL === 'true' };
  if (is('POST', /^\/login$/)) {
    const r = await call<{ token: string; isNewCheckin: boolean }>('login', { name: b.name, employeeId: b.employeeId });
    await signInWithCustomToken(auth, r.token);
    meCache = null;
    return { ok: true, isNewCheckin: r.isNewCheckin, csrfToken: '' };
  }
  if (is('POST', /^\/logout$/)) { meCache = null; await signOut(auth); return { ok: true }; }
  if (is('GET', /^\/me$/)) {
    const me = await currentMe(true);
    let [ci, emp] = await Promise.all([getDoc(doc(db, 'checkins', me.uid)), getDoc(doc(db, 'employeeIds', me.uid))]);
    if (!ci.exists()) {
      // 행운권 초기화 직후 등: 로그인은 되어 있지만 번호가 없으면 새로 받는다
      await call('ensureTicket', {});
      ci = await getDoc(doc(db, 'checkins', me.uid));
    }
    return {
      id: me.uid, name: me.name, employeeIdMasked: mask(emp.data()?.employeeId ?? ''), teamNumber: me.teamNumber, teamName: teamLabel(me.teamNumber),
      seatNote: SEAT_NOTES[me.teamNumber] ?? '', ticketNumber: ci.data()?.ticket ?? null, checkedInAt: iso(ci.data(est)?.at),
      isStaff: me.role !== 'participant', role: me.role, csrfToken: '', demo: import.meta.env.VITE_DEMO_LABEL === 'true',
    };
  }

  // ── 참가자 공개 정보 ──
  if (is('GET', /^\/home$/)) {
    const me = await currentMe();
    const [e, items, anns] = await Promise.all([readEvent(), readSchedule(false), readAnnouncements(me, false)]);
    const nn = computeNowNext(items);
    return { event: eventInfo(e), nowNext: nn, current: items.filter((i) => nn.currentIds.includes(i.id)), next: items.find((i) => i.id === nn.nextId) ?? null, announcements: anns.slice(0, 5) };
  }
  if (is('GET', /^\/schedule$/)) {
    await currentMe();
    const [e, items] = await Promise.all([readEvent(), readSchedule(false)]);
    return { event: eventInfo(e), items, nowNext: computeNowNext(items), lastUpdated: items.reduce((x, i) => (i.updatedAt > x ? i.updatedAt : x), iso(e.updatedAt) ?? '') };
  }
  if (is('GET', /^\/games$/)) return { games: [] };
  if (is('GET', /^\/announcements$/)) { const me = await currentMe(); return { announcements: await readAnnouncements(me, false) }; }
  if ((m = is('POST', /^\/announcements\/([^/]+)\/read$/))) { const me = await currentMe(); await setDoc(doc(db, 'annReads', me.uid), { ids: { [m[1]]: true } }, { merge: true }); return { ok: true }; }

  // ── 도움 요청 ──
  if (is('GET', /^\/help$/)) {
    const me = await currentMe();
    const s = await getDocs(query(collection(db, 'help'), where('requesterId', '==', me.uid), orderBy('createdAt', 'desc'), limit(20)));
    return { requests: s.docs.map((d) => { const x = d.data(est); return { id: d.id, kind: x.kind, body: x.body, status: x.status, createdAt: isoNow(x.createdAt), updatedAt: isoNow(x.updatedAt) }; }) };
  }
  if (is('POST', /^\/help$/)) {
    const me = await currentMe();
    if (!['route', 'supplies', 'other'].includes(b.kind)) fail(400, 'invalid_kind', '요청 종류를 선택해 주세요.');
    const text = String(b.body ?? '').trim();
    if (text.length > 300) fail(400, 'too_long', '내용은 300자까지 입력할 수 있습니다.');
    if (b.kind === 'other' && text.length < 2) fail(400, 'body_required', '어떤 도움이 필요한지 적어 주세요.');
    const ref = doc(db, 'help', `${me.uid}_${b.clientReqId}`);
    try {
      await setDoc(ref, { requesterId: me.uid, requesterName: me.name, requesterTeam: me.teamNumber, kind: b.kind, body: text, status: 'open', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    } catch (e) { if (!(await getDoc(ref).catch(() => null))?.exists()) throw e; } // 재전송: 이미 저장된 요청
    return { request: { id: ref.id } };
  }

  // ── 채팅 ──
  if (is('GET', /^\/chat\/unread$/)) {
    const me = await currentMe();
    const reads = (await getDoc(doc(db, 'reads', me.uid))).data() ?? {};
    const count = async (ch: string) => {
      const since = reads[ch] instanceof Timestamp ? reads[ch] : Timestamp.fromMillis(0);
      const s = await getCountFromServer(query(collection(db, 'messages'), where('channel', '==', ch), where('createdAt', '>', since)));
      return Math.min(99, s.data().count);
    };
    const [all, team] = await Promise.all([count('all'), count(`team:${me.teamNumber}`)]);
    return { all, team };
  }
  if ((m = is('GET', /^\/chat\/([^/]+)\/messages$/))) {
    const me = await currentMe(); const ch = resolveChannel(me, decodeURIComponent(m[1]));
    const before = q.get('before');
    const parts = [where('channel', '==', ch), orderBy('createdAt', 'desc'), ...(before ? [startAfter(Timestamp.fromDate(new Date(before.split('|')[0])))] : []), limit(50)];
    const s = await getDocs(query(collection(db, 'messages'), ...(parts as [])));
    const messages = s.docs.map((d) => toMessage(d, me.uid)).reverse();
    return { channel: ch, messages, nextCursor: s.size === 50 ? `${messages[0].createdAt}|${messages[0].id}` : null };
  }
  if ((m = is('POST', /^\/chat\/([^/]+)\/messages$/))) {
    const me = await currentMe(); const ch = resolveChannel(me, decodeURIComponent(m[1]));
    const text = String(b.body ?? '').normalize('NFC').replace(/\r\n/g, '\n').trim();
    if (!text) fail(400, 'empty_message', '메시지를 입력해 주세요.');
    if (text.length > 500) fail(400, 'message_too_long', '메시지는 500자까지 보낼 수 있습니다.');
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(b.clientMsgId ?? '')) fail(400, 'invalid_client_id', '메시지를 다시 보내 주세요.');
    const ref = doc(db, 'messages', `${me.uid}_${b.clientMsgId}`);
    const batch = writeBatch(db);
    batch.set(ref, { channel: ch, senderId: me.uid, senderName: me.name, senderTeam: me.teamNumber, staff: me.role !== 'participant', body: text, createdAt: serverTimestamp(), deletedAt: null, hiddenAt: null });
    batch.set(doc(db, 'rate', me.uid), { lastAt: serverTimestamp() });
    try { await batch.commit(); } catch (e) {
      const existing = await getDoc(ref).catch(() => null);
      if (existing?.exists()) return { message: toMessage(existing, me.uid), replay: true };
      const err = toApiError(e);
      if (err.status === 403) fail(429, 'flood', '메시지를 너무 빠르게 보내고 있어요. 1초 뒤 다시 보내 주세요.');
      throw err;
    }
    void setDoc(doc(db, 'reads', me.uid), { [ch]: serverTimestamp() }, { merge: true }).catch(() => {});
    return { message: toMessage(await getDoc(ref), me.uid), replay: false };
  }
  if ((m = is('POST', /^\/chat\/([^/]+)\/read$/))) { const me = await currentMe(); await setDoc(doc(db, 'reads', me.uid), { [resolveChannel(me, m[1])]: serverTimestamp() }, { merge: true }); return { ok: true }; }
  if ((m = is('DELETE', /^\/chat\/messages\/([^/]+)$/))) {
    const me = await currentMe(); const ref = doc(db, 'messages', m[1]);
    const cur = await getDoc(ref);
    if (!cur.exists()) fail(404, 'not_found', '메시지를 찾을 수 없습니다.');
    if (cur.data()!.senderId !== me.uid) fail(403, 'not_owner', '내가 보낸 메시지만 삭제할 수 있습니다.');
    await updateDoc(ref, { deletedAt: serverTimestamp() });
    return { message: toMessage(await getDoc(ref), me.uid) };
  }
  if ((m = is('POST', /^\/chat\/messages\/([^/]+)\/report$/))) {
    const me = await currentMe();
    const msg = await getDoc(doc(db, 'messages', m[1])).catch(() => null);
    if (!msg?.exists()) fail(404, 'not_found', '메시지를 찾을 수 없습니다.');
    const x = msg!.data()!;
    await setDoc(doc(db, 'reports', `${m[1]}_${me.uid}`), { messageId: m[1], reporterId: me.uid, reporterName: me.name, reason: String(b.reason ?? '').slice(0, 200), status: 'open', createdAt: serverTimestamp(), channel: x.channel, body: x.body, senderName: x.senderName, senderTeam: x.senderTeam })
      .catch(async (e) => { if (!(await getDoc(doc(db, 'reports', `${m![1]}_${me.uid}`)).catch(() => null))?.exists()) throw e; });
    return { ok: true };
  }

  // ── 관리자: 점수 ──
  if (is('GET', /^\/admin\/scores\/categories$/)) { await staffOnly(); return { categories: CATS.map((c) => ({ ...c, subtypes: c.kind === 'event' ? SUBS : [] })) }; }
  if (is('GET', /^\/admin\/scores\/board$/)) { await staffOnly(); return { teams: await board(), generatedAt: new Date().toISOString() }; }
  if (is('GET', /^\/admin\/scores\/log$/)) {
    await staffOnly();
    const ledger = await readLedger();
    const team = Number(q.get('team')) || 0; const cat = q.get('category'); const actor = q.get('actor'); const st = q.get('status');
    const actors = new Map<string, string>();
    ledger.forEach((e) => { actors.set(e.actorId, e.actorName); if (e.reversal) actors.set(e.reversal.actorId, e.reversal.actorName); });
    const entries = ledger.filter((e) => (!team || e.teamNumber === team) && (!cat || e.categoryKey === cat) && (!actor || e.actorId === actor || e.reversal?.actorId === actor) && (!st || e.status === st))
      .slice(0, Number(q.get('limit')) || 300);
    return { entries, actors: [...actors].map(([id, name]) => ({ id, name })) };
  }
  if (is('POST', /^\/admin\/scores\/awards$/)) {
    await staffOnly();
    const r = await call<{ id: string; replay: boolean }>('awardScore', b);
    return { award: { id: r.id }, replay: r.replay, teams: await board() };
  }
  if ((m = is('POST', /^\/admin\/scores\/awards\/([^/]+)\/cancel$/))) {
    await staffOnly();
    const r = await call<{ replay: boolean }>('cancelScore', { awardId: m[1], password: b.password, reason: b.reason, idempotencyKey: b.idempotencyKey });
    return { reversal: { awardId: m[1] }, replay: r.replay, teams: await board() };
  }

  // ── 관리자: 행운권·체크인 ──
  if ((m = is('GET', /^\/admin\/tickets\/([^/]+)$/))) {
    const me = await staffOnly();
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 1 || n > 100000) fail(400, 'invalid_ticket', '행운권 번호를 숫자로 입력해 주세요.');
    const [t, issued] = await Promise.all([getDoc(doc(db, 'tickets', String(n))), getCountFromServer(collection(db, 'checkins'))]);
    void auditLog(me, 'ticket_lookup', String(n));
    if (!t.exists()) return { issued: issued.data().count, ticket: null };
    const uid = t.data()!.uid as string;
    const [p, c, emp] = await Promise.all([
      getDoc(doc(db, 'participants', uid)), getDoc(doc(db, 'checkins', uid)),
      me.role === 'owner' ? getDoc(doc(db, 'employeeIds', uid)) : Promise.resolve(null),
    ]);
    const x = p.data() ?? {};
    return { issued: issued.data().count, ticket: { ticketNumber: n, name: x.name, teamNumber: x.teamNumber, role: x.role, active: x.active, checkedInAt: isoNow(c.data(est)?.at), employeeId: emp?.data()?.employeeId ?? '(owner만 확인)' } };
  }
  if (is('GET', /^\/admin\/checkins$/)) {
    const me = await staffOnly();
    const [ps, cs, emps] = await Promise.all([
      getDocs(collection(db, 'participants')), getDocs(collection(db, 'checkins')),
      me.role === 'owner' ? getDocs(collection(db, 'employeeIds')) : Promise.resolve(null),
    ]);
    const ci = new Map(cs.docs.map((d) => [d.id, d.data(est)]));
    const emp = new Map(emps?.docs.map((d) => [d.id, d.data().employeeId as string]) ?? []);
    const people = ps.docs.map((d) => { const x = d.data(); const c = ci.get(d.id); return { id: d.id, name: x.name, employeeId: emp.get(d.id) ?? '비공개', teamNumber: x.teamNumber, role: x.role, active: x.active, ticketNumber: c?.ticket ?? null, checkedInAt: c ? isoNow(c.at) : null }; })
      .sort((a, b) => a.teamNumber - b.teamNumber || a.name.localeCompare(b.name));
    const act = people.filter((p) => p.active);
    return { teams: [1, 2, 3, 4, 5, 6, 7, 8, 0].map((t) => ({ teamNumber: t, total: act.filter((p) => p.teamNumber === t).length, checkedIn: act.filter((p) => p.teamNumber === t && p.checkedInAt).length })), total: act.length, checkedIn: act.filter((p) => p.checkedInAt).length, people };
  }

  // ── 인원 추가 · 행운권 초기화 ──
  if (is('POST', /^\/admin\/participants$/)) { await staffOnly(); return await call('addParticipant', { name: b.name, employeeId: b.employeeId, teamNumber: b.teamNumber, role: b.role }); }
  if (is('POST', /^\/owner\/tickets\/reset$/)) { await staffOnly(true); return await call('resetTickets', { confirm: b.confirm, password: b.password }); }

  // ── 관리자: 공지·일정·안내 ──
  if (is('GET', /^\/admin\/announcements$/)) { const me = await staffOnly(); return { announcements: await readAnnouncements(me, true) }; }
  if (is('POST', /^\/admin\/announcements$/)) {
    await staffOnly();
    const r = await addDoc(collection(db, 'announcements'), { title: String(b.title ?? '').trim(), body: String(b.body ?? '').trim(), important: !!b.important, published: b.published !== false, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return { id: r.id };
  }
  if ((m = is('PATCH', /^\/admin\/announcements\/([^/]+)$/))) {
    await staffOnly();
    await updateDoc(doc(db, 'announcements', m[1]), { title: String(b.title ?? '').trim(), body: String(b.body ?? '').trim(), important: !!b.important, published: b.published !== false, updatedAt: serverTimestamp() });
    return { ok: true };
  }
  if (is('GET', /^\/admin\/schedule$/)) { await staffOnly(); return { items: await readSchedule(true) }; }
  if ((m = is('PATCH', /^\/admin\/schedule\/([^/]+)$/))) {
    const me = await staffOnly();
    await updateDoc(doc(db, 'schedule', m[1]), { title: String(b.title ?? '').trim(), note: String(b.note ?? '').trim(), startTime: b.startTime || null, endTime: b.endTime || null, status: b.status, delayNote: String(b.delayNote ?? '').trim(), public: b.public !== false, updatedAt: serverTimestamp() });
    void auditLog(me, 'schedule_update', m[1], { status: b.status });
    return { ok: true };
  }
  if (is('POST', /^\/admin\/schedule$/)) {
    await staffOnly();
    const items = await readSchedule(true);
    const r = await addDoc(collection(db, 'schedule'), { sortOrder: Math.max(0, ...items.map((i) => i.sortOrder)) + 10, startTime: b.startTime || null, endTime: b.endTime || null, title: String(b.title ?? '').trim(), note: String(b.note ?? '').trim(), kind: 'general', status: b.startTime ? 'scheduled' : 'time_tbd', delayNote: '', public: b.public !== false, updatedAt: serverTimestamp() });
    return { id: r.id };
  }
  if (is('GET', /^\/admin\/games$/)) return { games: [] };
  if (is('GET', /^\/admin\/event$/)) {
    await staffOnly(); const e = await readEvent();
    return { schedulePublished: !!e.schedulePublished, parkingPublished: !!e.parkingPublished, parkingNote: e.parkingNote ?? '', returnBusPublished: !!e.returnBusPublished, returnBusNote: e.returnBusNote ?? '', departureNote: e.departureNote ?? '', statusNote: e.statusNote ?? '', statusNoteUpdatedAt: iso(e.statusNoteUpdatedAt) };
  }
  if (is('PATCH', /^\/admin\/event$/)) {
    const me = await staffOnly(); const e = await readEvent();
    const patch: Record<string, unknown> = { updatedAt: serverTimestamp() };
    for (const k of ['schedulePublished', 'parkingPublished', 'returnBusPublished']) if (typeof b[k] === 'boolean') patch[k] = b[k];
    for (const k of ['parkingNote', 'returnBusNote', 'departureNote']) if (typeof b[k] === 'string') patch[k] = b[k].trim();
    if (typeof b.statusNote === 'string' && b.statusNote.trim() !== (e.statusNote ?? '')) { patch.statusNote = b.statusNote.trim(); patch.statusNoteUpdatedAt = serverTimestamp(); }
    await updateDoc(doc(db, 'config', 'event'), patch);
    void auditLog(me, 'event_info_update', null, { fields: Object.keys(b) });
    return { ok: true };
  }

  // ── 관리자: 요청·신고·채팅 관리 ──
  if (is('GET', /^\/admin\/help$/)) {
    await staffOnly();
    const s = await getDocs(query(collection(db, 'help'), orderBy('createdAt', 'desc'), limit(200)));
    return { requests: s.docs.map((d) => { const x = d.data(est); return { id: d.id, kind: x.kind, body: x.body, status: x.status, createdAt: isoNow(x.createdAt), updatedAt: isoNow(x.updatedAt), name: x.requesterName, teamNumber: x.requesterTeam }; })
      .sort((a, c) => Number(a.status === 'done') - Number(c.status === 'done')) };
  }
  if ((m = is('PATCH', /^\/admin\/help\/([^/]+)$/))) { await staffOnly(); await updateDoc(doc(db, 'help', m[1]), { status: b.status, updatedAt: serverTimestamp() }); return { ok: true }; }
  if (is('GET', /^\/admin\/reports$/)) {
    await staffOnly();
    const s = await getDocs(query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(200)));
    return { reports: s.docs.map((d) => { const x = d.data(est); return { id: d.id, reason: x.reason, status: x.status, createdAt: isoNow(x.createdAt), messageId: x.messageId, channel: x.channel, body: x.body, senderName: x.senderName, senderTeam: x.senderTeam, hidden: false, deleted: false, reporterName: x.reporterName }; })
      .sort((a, c) => Number(a.status !== 'open') - Number(c.status !== 'open')) };
  }
  if ((m = is('PATCH', /^\/admin\/reports\/([^/]+)$/))) { const me = await staffOnly(); await updateDoc(doc(db, 'reports', m[1]), { status: b.status, handledBy: me.uid }); return { ok: true }; }
  if ((m = is('POST', /^\/admin\/chat\/messages\/([^/]+)\/hide$/))) {
    const me = await staffOnly(); const hidden = b.hidden !== false;
    await updateDoc(doc(db, 'messages', m[1]), { hiddenAt: hidden ? serverTimestamp() : null, hiddenBy: me.uid });
    void auditLog(me, hidden ? 'chat_hide' : 'chat_unhide', m[1]);
    const after = await getDoc(doc(db, 'messages', m[1])).catch(() => null);
    return { message: after?.exists() ? toMessage(after, me.uid) : { id: m[1], state: hidden ? 'hidden' : 'ok' } };
  }
  if ((m = is('GET', /^\/admin\/chat\/team\/([^/]+)$/))) { await staffOnly(); return await call('adminTeamChat', { team: Number(m[1]) }); }
  if (is('GET', /^\/admin\/setup-checklist$/)) {
    await staffOnly();
    const [e, ps] = await Promise.all([readEvent(), getDocs(collection(db, 'participants'))]);
    const active = ps.docs.filter((d) => d.data().active); const staffN = active.filter((d) => d.data().role !== 'participant').length;
    return { items: [
      { key: 'roster', label: '실제 참가자 명단 업로드', done: active.length > staffN, detail: `활성 ${active.length}명 (운영진 ${staffN}명)` },
      { key: 'cancel_password', label: '점수 취소 비밀번호 운영값 설정', done: false, detail: 'Functions 설정값 CANCEL_PASSWORD_HASH로 변경 (비우면 1234)' },
      { key: 'schedule', label: '최종 일정 확정 공개', done: !!e.schedulePublished, detail: e.schedulePublished ? '공개됨' : '참가자에게 ‘초안’으로 표시 중' },
      { key: 'parking', label: '주차 안내(3시간 무료·초과 개인 부담) 확인 후 공개', done: !!e.parkingPublished, detail: e.parkingPublished ? '공개됨' : '미공개' },
      { key: 'return_bus', label: '퇴근버스 탑승 안내 확인', done: !!e.returnBusPublished && !!e.returnBusNote, detail: e.returnBusNote || '미입력' },
      { key: 'rules', label: '경기별 동률·교체·실패 기준, 제기차기 배점 해석 확정', done: false, detail: '현장 심판 브리핑에서 확정 (앱 자동채점 없음)' },
    ] };
  }

  // ── owner ──
  if (is('POST', /^\/owner\/roster\/preview$/)) { await staffOnly(true); return await call('importRoster', { csv: b.csv, commit: false }); }
  if (is('POST', /^\/owner\/roster\/commit$/)) { await staffOnly(true); return await call('importRoster', { csv: b.csv, commit: true, confirmRoleChanges: b.confirmRoleChanges === true }); }
  if ((m = is('POST', /^\/owner\/participants\/([^/]+)\/role$/))) { await staffOnly(true); return await call('setRole', { uid: m[1], role: b.role }); }
  if ((m = is('POST', /^\/owner\/participants\/([^/]+)\/team$/))) { await staffOnly(true); return await call('changeTeam', { uid: m[1], teamNumber: b.teamNumber, reason: b.reason }); }
  if (is('GET', /^\/owner\/audit$/)) {
    await staffOnly(true);
    const s = await getDocs(query(collection(db, 'audit'), orderBy('createdAt', 'desc'), limit(300)));
    return { events: s.docs.map((d) => { const x = d.data(est); return { id: d.id, actorName: x.actorName, action: x.action, target: x.target, detail: x.detail, createdAt: isoNow(x.createdAt) }; }) };
  }
  return fail(404, 'not_found', '지원하지 않는 기능입니다.');
}

/** 관리자 화면의 CSV 내보내기 링크를 브라우저에서 처리 */
export async function exportCsv(href: string): Promise<{ name: string; csv: string }> {
  const me = await staffOnly();
  const cell = (v: unknown) => { let x = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; return /[",\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  const csv = (h: string[], rows: unknown[][]) => '﻿' + [h, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  const kst = (s: string | null) => (s ? new Date(s).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) : '');
  if (href.includes('/admin/scores/export.csv')) {
    void auditLog(me, 'export_scores');
    return { name: 'score-log.csv', csv: csv(['기록ID', '부여일시(KST)', '조', '종목', '세부유형', '점수', '사유', '부여자', '상태', '취소일시(KST)', '취소자', '취소사유', '상쇄점수'],
      (await readLedger()).map((e) => [e.id, kst(e.createdAt), `${e.teamNumber}조`, e.categoryLabel, e.subtypeLabel ?? '', e.points, e.reason, e.actorName, e.status === 'cancelled' ? '취소' : '유효', kst(e.reversal?.createdAt ?? null), e.reversal?.actorName ?? '', e.reversal?.reason ?? '', e.reversal?.points ?? ''])) };
  }
  if (me.role !== 'owner') fail(403, 'forbidden', 'owner만 사용할 수 있습니다.');
  if (href.includes('/owner/export/checkins.csv')) {
    const r = await call<{ rows: { employeeId: string; name: string; teamNumber: number; role: string; active: boolean; seq: number | null; ticket: number | null; at: string | null }[] }>('exportRoster', {});
    return { name: 'checkins.csv', csv: csv(['사번', '이름', '조', '역할', '활성', '체크인순번', '행운권', '체크인시각(KST)'],
      r.rows.sort((a, c) => a.teamNumber - c.teamNumber).map((x) => [x.employeeId, x.name, x.teamNumber, x.role, x.active ? 'Y' : 'N', x.seq ?? '', x.ticket ? String(x.ticket).padStart(3, '0') : '', kst(x.at)])) };
  }
  const s = await getDocs(query(collection(db, 'audit'), orderBy('createdAt', 'asc')));
  void auditLog(me, 'export_audit');
  return { name: 'audit.csv', csv: csv(['시각(KST)', '수행자', '동작', '대상', '상세'], s.docs.map((d) => { const x = d.data(est); return [kst(isoNow(x.createdAt)), x.actorName, x.action, x.target ?? '', JSON.stringify(x.detail ?? {})]; })) };
}
