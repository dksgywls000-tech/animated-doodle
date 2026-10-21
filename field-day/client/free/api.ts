/**
 * Firebase 무료(Spark) 요금제용 어댑터 — 화면 코드의 '/api/...' 요청을 Firestore 직접 읽기·쓰기로 처리한다.
 * 서버 함수가 없으므로 권한·검증은 firebase-free/firestore.rules가 맡는다.
 * 무료 읽기 한도(하루 5만 건)를 아끼기 위해 공지·일정·행사 안내는 config/public 문서 하나에 모아 둔다.
 */
import { signOut } from 'firebase/auth';
import {
  collection, doc, getDoc, getDocs, query, where, orderBy, limit, startAfter, writeBatch, setDoc, updateDoc, addDoc,
  serverTimestamp, Timestamp, getCountFromServer, runTransaction, deleteDoc, type DocumentSnapshot,
} from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';
import { auth, authReady, db, configMissing, deviceUser } from './fb';
import { CATEGORIES, EVENT_SUBTYPES, SEAT_NOTES, SCHEDULE, RETURN_BUS_NOTE, teamLabel } from '../../server/services/seedData';
import { computeNowNext } from '../shared/nowNext';
import { empKey, isTeam, loginKey, normalizeEmployeeId, normalizeName, parseRoster, secureShuffle, sha256hex, type Role } from '../shared/roster';
import type { ScheduleItem } from '../src/types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, any> = {}) { super(message); }
  get unknownOutcome() { return this.status === 0; }
}
export const setCsrf = (_t: string) => {};
export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
const LOGIN_FAILED = '이름과 사번을 확인해 주세요. 계속 안 되면 운영진에게 문의해 주세요.';
const fail = (status: number, code: string, message: string, extra: Record<string, any> = {}): never => { throw new ApiError(status, code, message, extra); };

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  const code = e instanceof FirebaseError ? e.code.replace(/^(firestore|auth)\//, '') : '';
  if (code === 'unavailable' || code === 'deadline-exceeded' || (!navigator.onLine)) return new ApiError(0, 'network', '네트워크 연결이 불안정합니다. 연결을 확인한 뒤 다시 시도해 주세요.');
  if (code === 'permission-denied') return new ApiError(403, 'forbidden', '권한이 없거나 허용되지 않은 요청입니다.');
  if (code === 'resource-exhausted') return new ApiError(429, 'quota', '오늘 무료 사용량을 넘었습니다. 운영진에게 알려 주세요.');
  if (code === 'admin-restricted-operation' || code === 'operation-not-allowed') return new ApiError(503, 'auth_disabled', 'Firebase에서 익명 로그인이 꺼져 있습니다. 운영자에게 알려 주세요.');
  return new ApiError(500, code || 'error', '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
}
const isDenied = (e: unknown) => e instanceof FirebaseError && /permission-denied/.test(e.code);
const isAborted = (e: unknown) => e instanceof FirebaseError && /aborted/.test(e.code);

const iso = (v: unknown): string | null => (v instanceof Timestamp ? v.toDate().toISOString() : typeof v === 'number' ? new Date(v).toISOString() : typeof v === 'string' ? v : null);
const isoNow = (v: unknown) => iso(v) ?? new Date().toISOString();
const est = { serverTimestamps: 'estimate' as const };
const mask = (id: string) => (id.length <= 2 ? '**' : id.slice(0, 2) + '*'.repeat(Math.max(1, id.length - 4)) + id.slice(-2));
const rid = () => crypto.randomUUID().replace(/-/g, '');
export const chatColl = (ch: string) => (ch === 'all' ? 'chat_all' : `chat_team_${ch.split(':')[1]}`);
export const pwHash = (pw: string) => sha256hex(`fd26pw|${pw}`);
const ls = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* 무시 */ } },
};

export const CATS = CATEGORIES.map(([key, label, kind]) => ({ key, label, kind }));
const SUBS = EVENT_SUBTYPES.map(([key, label]) => ({ key, label }));

// ── 현재 사용자 ──
export interface Me { uid: string; pid: string; name: string; teamNumber: number; role: Role; active: boolean }
let meCache: { at: number; me: Me } | null = null;
export async function currentMe(fresh = false): Promise<Me> {
  const user = auth.currentUser ?? (await authReady);
  if (!user) fail(401, 'unauthenticated', '로그인이 필요합니다. 이름과 사번으로 다시 입장해 주세요.');
  if (!fresh && meCache && meCache.me.uid === user!.uid && Date.now() - meCache.at < 3000) return meCache.me;
  const b = await getDoc(doc(db, 'bindings', user!.uid)).catch(() => null);
  const pid = b?.data()?.pid as string | undefined;
  if (!pid) fail(401, 'unauthenticated', '로그인이 필요합니다. 이름과 사번으로 다시 입장해 주세요.');
  const p = await getDoc(doc(db, 'participants', pid!)).catch(() => null);
  const d = p?.data();
  if (!d || !d.active) { await logoutDevice(); fail(401, 'unauthenticated', '로그인이 필요합니다. 이름과 사번으로 다시 입장해 주세요.'); }
  const me: Me = { uid: user!.uid, pid: pid!, name: d!.name, teamNumber: d!.teamNumber, role: d!.role, active: true };
  meCache = { at: Date.now(), me };
  return me;
}
async function logoutDevice() {
  meCache = null;
  const u = auth.currentUser;
  if (u) await deleteDoc(doc(db, 'bindings', u.uid)).catch(() => {});
  await signOut(auth).catch(() => {});
}
const staffOnly = async (owner = false) => {
  const me = await currentMe();
  if (owner ? me.role !== 'owner' : me.role === 'participant') fail(403, 'forbidden', owner ? 'owner만 사용할 수 있습니다.' : '관리자만 사용할 수 있습니다.');
  return me;
};
async function auditLog(me: { pid: string; name: string }, action: string, target: string | null = null, detail: Record<string, unknown> = {}) {
  try { await addDoc(collection(db, 'audit'), { actorId: me.pid, actorName: me.name, action, target, detail, createdAt: serverTimestamp() }); } catch { /* 감사 실패가 동작을 막지 않게 */ }
}

// ── 행운권 배정 (규칙이 순번·번호를 검증) ──
export async function ensureTicket(pid: string, teamNumber: number): Promise<{ ticket: number; seq: number; isNew: boolean }> {
  const ci = await getDoc(doc(db, 'checkins', pid));
  if (ci.exists()) return { ticket: ci.data().ticket, seq: ci.data().seq, isNew: false };
  // 1단계: 순번 선점 (이미 선점했으면 건너뜀)
  let claim = await getDoc(doc(db, 'claims', pid));
  if (!claim.exists()) {
    let k = (await getCountFromServer(collection(db, 'slots'))).data().count + 1;
    for (let attempt = 0; attempt < 400; attempt++) {
      const b = writeBatch(db);
      b.set(doc(db, 'claims', pid), { seq: k });
      b.set(doc(db, 'slots', String(k)), { pid });
      try { await b.commit(); break; } catch (e) {
        if (!isDenied(e) && !isAborted(e)) throw e;
        claim = await getDoc(doc(db, 'claims', pid));
        if (claim.exists()) break;                       // 다른 기기에서 먼저 선점
        if (attempt % 8 === 7) k = (await getCountFromServer(collection(db, 'slots'))).data().count + 1;
        else k += 1;                                     // 누가 먼저 가져감 → 다음 순번
        await new Promise((r) => setTimeout(r, Math.random() * 120));
      }
    }
    claim = await getDoc(doc(db, 'claims', pid));
    if (!claim.exists()) fail(503, 'busy', '접속이 몰려 잠시 처리하지 못했습니다. 다시 입장해 주세요. (번호는 중복 배정되지 않습니다)');
  }
  const seq = claim.data()!.seq as number;
  const ticket = seq <= 300 ? ((await getDoc(doc(db, 'pool', String(seq)))).data()!.n as number) : seq;
  // 2단계: 번호 확정
  const b = writeBatch(db);
  b.set(doc(db, 'checkins', pid), { seq, ticket, teamNumber, at: serverTimestamp() });
  b.set(doc(db, 'tickets', String(ticket)), { pid, seq });
  for (let attempt = 0; ; attempt++) {
    try { await b.commit(); break; } catch (e) {
      const again = await getDoc(doc(db, 'checkins', pid));
      if (again.exists()) return { ticket: again.data().ticket, seq: again.data().seq, isNew: false };
      if (!isAborted(e) || attempt > 5) throw e;
      await new Promise((r) => setTimeout(r, 100 + Math.random() * 300));
    }
  }
  return { ticket, seq, isNew: true };
}

// ── 공개 문서(행사 안내·일정·공지) ──
interface CouponDoc { active: boolean; id: string; title: string; winners: number; eligible: number; deployedAt: number }
interface PublicDoc { [k: string]: any; schedule: any[]; announcements: any[] }
let publicCache: { at: number; data: PublicDoc } | null = null;
export function setPublicCache(data: PublicDoc | null) { publicCache = data ? { at: Date.now(), data } : null; }
async function readPublic(fresh = false): Promise<PublicDoc> {
  if (!fresh && publicCache) return publicCache.data;     // 실시간 구독이 최신 상태를 유지
  const s = await getDoc(doc(db, 'config', 'public'));
  if (!s.exists()) fail(503, 'not_initialized', '행사 설정이 아직 끝나지 않았습니다. 운영진에게 문의해 주세요.');
  const data = s.data(est) as PublicDoc;
  publicCache = { at: Date.now(), data };
  return data;
}
const eventInfo = (e: PublicDoc) => ({
  title: e.title, date: e.date, venue: e.venue, departureNote: e.departureNote ?? '',
  parking: e.parkingPublished ? e.parkingNote : null, returnBus: e.returnBusPublished && e.returnBusNote ? e.returnBusNote : null,
  statusNote: e.statusNote || null, statusNoteUpdatedAt: iso(e.statusNoteUpdatedAt), schedulePublished: !!e.schedulePublished,
});
const items = (e: PublicDoc, all: boolean): ScheduleItem[] => (e.schedule ?? []).filter((i: any) => all || i.public)
  .map((i: any) => ({ ...i, gameKey: null, updatedAt: isoNow(i.updatedAt) })).sort((a: any, b: any) => a.sortOrder - b.sortOrder);
const readIds = (): Record<string, boolean> => { try { return JSON.parse(ls.get('fd-ann-read') ?? '{}'); } catch { return {}; } };
const anns = (e: PublicDoc, all: boolean) => {
  const ids = readIds();
  return (e.announcements ?? []).filter((a: any) => all || a.published)
    .map((a: any) => ({ ...a, createdAt: isoNow(a.createdAt), updatedAt: isoNow(a.updatedAt), read: !!ids[a.id] }))
    .sort((a: any, b: any) => Number(b.important) - Number(a.important) || b.createdAt.localeCompare(a.createdAt));
};
/** 관리자가 공개 문서를 고칠 때 — 동시에 두 명이 고쳐도 덮어쓰지 않도록 트랜잭션 */
async function editPublic(fn: (d: PublicDoc) => Partial<PublicDoc>) {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'config', 'public');
    const s = await tx.get(ref);
    const patch = fn(s.data() as PublicDoc);
    tx.update(ref, { ...patch, updatedAt: serverTimestamp() });
  });
  publicCache = null;
}

// ── 채팅 ──
const msgColl = new Map<string, string>(); // 메시지 ID → 컬렉션 (숨김 처리용)
export function toMessage(d: DocumentSnapshot, coll: string, viewer?: string) {
  const x = d.data(est)!;
  msgColl.set(d.id, coll);
  const state = x.hiddenAt ? 'hidden' : x.deletedAt ? 'deleted' : 'ok';
  const channel = coll === 'chat_all' ? 'all' : `team:${coll.replace('chat_team_', '')}`;
  return {
    id: d.id, channel, senderId: x.senderId, senderName: x.senderName, senderTeam: x.senderTeam, staff: x.staff,
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
const lastRead = (pid: string, ch: string) => Number(ls.get(`fd-read|${pid}|${ch}`) ?? 0);
const markRead = (pid: string, ch: string) => ls.set(`fd-read|${pid}|${ch}`, String(Date.now()));
/** 전체 초기화 이후 메시지만 보이게(다른 조 채팅은 owner도 읽을 수 없어 지우는 대신 기준 시각을 둔다) */
async function chatSince(): Promise<Timestamp | null> {
  const v = (await readPublic()).chatResetAt;
  return v instanceof Timestamp ? v : typeof v === 'number' ? Timestamp.fromMillis(v) : null;
}

// ── 점수 ──
export async function readLedger() {
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
async function board() {
  const ledger = await readLedger();
  const teams = Array.from({ length: 8 }, (_, i) => {
    const t = i + 1; const mine = ledger.filter((e) => e.teamNumber === t);
    return { teamNumber: t, name: `${t}조`, total: mine.reduce((s, e) => s + e.points + (e.reversal?.points ?? 0), 0), activeAwards: mine.filter((e) => !e.reversal).length };
  });
  return teams.map((t) => ({ ...t, rank: 1 + teams.filter((o) => o.total > t.total).length }));
}

/** '이름' 또는 '이름 3조'를 줄바꿈·쉼표로 여러 명 받아 coll/{pid}에 {name, teamNumber} 저장 */
async function addByNames(coll: 'couponExclude' | 'leaders', text: string) {
  const added: string[] = []; const problems: string[] = [];
  for (const raw of text.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean).slice(0, 100)) {
    const mm = /^(.+?)\s*\(?\s*([0-8])\s*조?\s*\)?$/.exec(raw);
    const name = normalizeName(mm ? mm[1] : raw); const team = mm ? Number(mm[2]) : null;
    const found = (await getDocs(query(collection(db, 'participants'), where('name', '==', name)))).docs.filter((d) => team === null || d.data().teamNumber === team);
    if (!found.length) { problems.push(`${raw}: 명단에 없음`); continue; }
    if (found.length > 1) { problems.push(`${raw}: 같은 이름 ${found.length}명 — '${name} 3조'처럼 조를 붙여 주세요`); continue; }
    const d = found[0];
    await setDoc(doc(db, coll, d.id), { name: d.data().name, teamNumber: d.data().teamNumber, createdAt: serverTimestamp() });
    added.push(`${d.data().name}(${teamLabel(d.data().teamNumber)})`);
  }
  return { added, problems };
}

/** 행운권: 입장 기록·번호·순번을 지우고 1~300을 새로 섞는다. 지운 입장 기록 수를 돌려준다 */
async function resetTickets() {
  const removed = (await getCountFromServer(collection(db, 'checkins'))).data().count;
  const ops: ((bt: ReturnType<typeof writeBatch>) => void)[] = [];
  for (const col of ['checkins', 'tickets', 'claims', 'slots']) {
    const sn = await getDocs(collection(db, col));
    sn.docs.forEach((d) => ops.push((bt) => bt.delete(d.ref)));
  }
  secureShuffle(300).forEach((n, i) => ops.push((bt) => bt.set(doc(db, 'pool', String(i + 1)), { n })));
  await writeChunks(ops);
  return removed;
}

// ── 명단 쓰기 도우미 ──
async function writeChunks(ops: ((b: ReturnType<typeof writeBatch>) => void)[]) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    ops.slice(i, i + 400).forEach((op) => op(b));
    await b.commit();
  }
}

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
  if (is('GET', /^\/public\/event$/)) return { title: '2026 하이테크본부 가을운동회', date: '2026-10-21', venue: '이충동 부락산 분수공원 야외공연장', demo: false };
  if (is('POST', /^\/login$/)) {
    const name = normalizeName(b.name); const emp = normalizeEmployeeId(b.employeeId);
    if (!name || !emp) fail(400, 'login_failed', LOGIN_FAILED);
    // 기기별 연속 실패 제한(화면 보조용 — 서버 함수가 없어 완전한 제한은 아님)
    const fails = (JSON.parse(ls.get('fd-login-fails') ?? '[]') as number[]).filter((t) => Date.now() - t < 10 * 60_000);
    if (fails.length >= 5) fail(429, 'rate_limited', '입력 시도가 많아 잠시 제한되었습니다. 약 10분 후 다시 시도하거나 운영진에게 문의해 주세요.');
    const user = await deviceUser();
    const key = await loginKey(emp, name);
    const idx = await getDoc(doc(db, 'loginIndex', key));
    const pid = idx.data()?.pid as string | undefined;
    const bindFail = () => { ls.set('fd-login-fails', JSON.stringify([...fails, Date.now()])); return fail(401, 'login_failed', LOGIN_FAILED); };
    if (!pid) bindFail();
    try { await setDoc(doc(db, 'bindings', user.uid), { pid, key, createdAt: serverTimestamp() }); } catch (e) { if (isDenied(e)) bindFail(); throw e; }
    meCache = null;
    const me = await currentMe(true);
    const t = await ensureTicket(me.pid, me.teamNumber);
    return { ok: true, isNewCheckin: t.isNew, csrfToken: '' };
  }
  if (is('POST', /^\/logout$/)) { await logoutDevice(); return { ok: true }; }
  if (is('GET', /^\/me$/)) {
    const me = await currentMe(true);
    let ci = await getDoc(doc(db, 'checkins', me.pid));
    if (!ci.exists()) { await ensureTicket(me.pid, me.teamNumber); ci = await getDoc(doc(db, 'checkins', me.pid)); } // 행운권 초기화 직후 등
    const [emp, ld] = await Promise.all([getDoc(doc(db, 'employeeIds', me.pid)).catch(() => null), getDoc(doc(db, 'leaders', me.pid)).catch(() => null)]);
    return {
      isLeader: !!ld?.exists() && ld.data()!.teamNumber === me.teamNumber,
      id: me.pid, name: me.name, employeeIdMasked: mask(emp?.data()?.employeeId ?? ''), teamNumber: me.teamNumber, teamName: teamLabel(me.teamNumber),
      seatNote: SEAT_NOTES[me.teamNumber] ?? '', ticketNumber: ci.data()?.ticket ?? null, checkedInAt: iso(ci.data(est)?.at),
      isStaff: me.role !== 'participant', role: me.role, csrfToken: '', demo: false,
    };
  }

  // ── 공개 안내 ──
  if (is('GET', /^\/home$/)) {
    await currentMe();
    const e = await readPublic(); const its = items(e, false); const nn = computeNowNext(its);
    return { event: eventInfo(e), nowNext: nn, current: its.filter((i) => nn.currentIds.includes(i.id)), next: its.find((i) => i.id === nn.nextId) ?? null, announcements: anns(e, false).slice(0, 5) };
  }
  if (is('GET', /^\/schedule$/)) {
    await currentMe();
    const e = await readPublic(); const its = items(e, false);
    return { event: eventInfo(e), items: its, nowNext: computeNowNext(its), lastUpdated: isoNow(e.updatedAt) };
  }
  if (is('GET', /^\/games$/)) return { games: [] };
  if (is('GET', /^\/announcements$/)) { await currentMe(); return { announcements: anns(await readPublic(), false) }; }
  if ((m = is('POST', /^\/announcements\/([^/]+)\/read$/))) { ls.set('fd-ann-read', JSON.stringify({ ...readIds(), [m[1]]: true })); return { ok: true }; }

  // ── 도움 요청 ──
  if (is('GET', /^\/help$/)) {
    const me = await currentMe();
    const s = await getDocs(query(collection(db, 'help'), where('requesterId', '==', me.pid)));
    return { requests: s.docs.map((d) => { const x = d.data(est); return { id: d.id, kind: x.kind, body: x.body, status: x.status, createdAt: isoNow(x.createdAt), updatedAt: isoNow(x.updatedAt) }; }).sort((a, c) => c.createdAt.localeCompare(a.createdAt)) };
  }
  if (is('POST', /^\/help$/)) {
    const me = await currentMe();
    if (!['route', 'supplies', 'other'].includes(b.kind)) fail(400, 'invalid_kind', '요청 종류를 선택해 주세요.');
    const text = String(b.body ?? '').trim();
    if (text.length > 300) fail(400, 'too_long', '내용은 300자까지 입력할 수 있습니다.');
    if (b.kind === 'other' && text.length < 2) fail(400, 'body_required', '어떤 도움이 필요한지 적어 주세요.');
    const ref = doc(db, 'help', `${me.pid}_${b.clientReqId}`);
    try { await setDoc(ref, { requesterId: me.pid, requesterName: me.name, requesterTeam: me.teamNumber, kind: b.kind, body: text, status: 'open', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); }
    catch (e) { if (!(await getDoc(ref).catch(() => null))?.exists()) throw e; }
    return { request: { id: ref.id } };
  }

  // ── 채팅 ──
  if (is('GET', /^\/chat\/unread$/)) {
    const me = await currentMe();
    const count = async (ch: string) => {
      const since = Timestamp.fromMillis(Math.max(lastRead(me.pid, ch), (await chatSince())?.toMillis() ?? 0));
      return Math.min(99, (await getCountFromServer(query(collection(db, chatColl(ch)), where('createdAt', '>', since)))).data().count);
    };
    const [all, team] = await Promise.all([count('all'), count(`team:${me.teamNumber}`)]);
    return { all, team };
  }
  if ((m = is('GET', /^\/chat\/([^/]+)\/messages$/))) {
    const me = await currentMe(); const ch = resolveChannel(me, decodeURIComponent(m[1])); const coll = chatColl(ch);
    const before = q.get('before');
    const since = await chatSince();
    const parts = [...(since ? [where('createdAt', '>', since)] : []), orderBy('createdAt', 'desc'), ...(before ? [startAfter(Timestamp.fromDate(new Date(before.split('|')[0])))] : []), limit(50)];
    const s = await getDocs(query(collection(db, coll), ...(parts as [])));
    const messages = s.docs.map((d) => toMessage(d, coll, me.pid)).reverse();
    return { channel: ch, messages, nextCursor: s.size === 50 ? `${messages[0].createdAt}|${messages[0].id}` : null };
  }
  if ((m = is('POST', /^\/chat\/([^/]+)\/messages$/))) {
    const me = await currentMe(); const ch = resolveChannel(me, decodeURIComponent(m[1])); const coll = chatColl(ch);
    const text = String(b.body ?? '').normalize('NFC').replace(/\r\n/g, '\n').trim();
    if (!text) fail(400, 'empty_message', '메시지를 입력해 주세요.');
    if (text.length > 500) fail(400, 'message_too_long', '메시지는 500자까지 보낼 수 있습니다.');
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(b.clientMsgId ?? '')) fail(400, 'invalid_client_id', '메시지를 다시 보내 주세요.');
    const ref = doc(db, coll, `${me.pid}_${b.clientMsgId}`);
    const batch = writeBatch(db);
    batch.set(ref, { senderId: me.pid, senderName: me.name, senderTeam: me.teamNumber, staff: me.role !== 'participant', body: text, createdAt: serverTimestamp(), deletedAt: null, hiddenAt: null });
    batch.set(doc(db, 'rate', me.pid), { lastAt: serverTimestamp() });
    try { await batch.commit(); } catch (e) {
      const existing = await getDoc(ref).catch(() => null);
      if (existing?.exists()) return { message: toMessage(existing, coll, me.pid), replay: true };
      if (isDenied(e)) fail(429, 'flood', '메시지를 너무 빠르게 보내고 있어요. 1초 뒤 다시 보내 주세요.');
      throw e;
    }
    markRead(me.pid, ch);
    return { message: toMessage(await getDoc(ref), coll, me.pid), replay: false };
  }
  if ((m = is('POST', /^\/chat\/([^/]+)\/read$/))) { const me = await currentMe(); markRead(me.pid, resolveChannel(me, m[1])); return { ok: true }; }
  if ((m = is('DELETE', /^\/chat\/messages\/([^/]+)$/))) {
    const me = await currentMe(); const coll = msgColl.get(m[1]);
    if (!coll) fail(404, 'not_found', '메시지를 찾을 수 없습니다.');
    const ref = doc(db, coll!, m[1]);
    await updateDoc(ref, { deletedAt: serverTimestamp() });
    return { message: toMessage(await getDoc(ref), coll!, me.pid) };
  }
  if ((m = is('POST', /^\/chat\/messages\/([^/]+)\/report$/))) {
    const me = await currentMe(); const coll = msgColl.get(m[1]);
    if (!coll) fail(404, 'not_found', '메시지를 찾을 수 없습니다.');
    const x = (await getDoc(doc(db, coll!, m[1]))).data()!;
    const channel = coll === 'chat_all' ? 'all' : `team:${coll!.replace('chat_team_', '')}`;
    const ref = doc(db, 'reports', `${m[1]}_${me.pid}`);
    await setDoc(ref, { messageId: m[1], channel, body: x.body, senderName: x.senderName, senderTeam: x.senderTeam, reporterId: me.pid, reporterName: me.name, reason: String(b.reason ?? '').slice(0, 200), status: 'open', createdAt: serverTimestamp() })
      .catch(async (e) => { if (!(await getDoc(ref).catch(() => null))?.exists()) throw e; });
    return { ok: true };
  }

  // ── 관리자: 점수 ──
  // ── 스크래치 쿠폰 ──
  if (is('GET', /^\/coupon$/)) {
    const me = await currentMe();
    const c = (await readPublic()).coupon as CouponDoc | undefined;
    if (!c?.id) return { active: false, title: '텀블러', id: null, mine: null };
    const s = await getDoc(doc(db, 'coupons', `${c.id}_${me.pid}`));
    const x = s.data();
    return { active: !!c.active, title: c.title, id: c.id, mine: x ? { win: !!x.win, scratched: !!x.scratchedAt } : null };
  }
  if (is('POST', /^\/coupon\/scratch$/)) {
    const me = await currentMe();
    const c = (await readPublic()).coupon as CouponDoc | undefined;
    if (!c?.id) fail(409, 'no_coupon', '진행 중인 쿠폰이 없습니다.');
    const ref = doc(db, 'coupons', `${c!.id}_${me.pid}`);
    try { await updateDoc(ref, { scratchedAt: serverTimestamp() }); } catch (e) { if (!isDenied(e)) throw e; } // 이미 긁음
    return { ok: true };
  }
  if (is('GET', /^\/admin\/coupon$/)) {
    await staffOnly();
    const c = (await readPublic(true)).coupon as CouponDoc | undefined;
    const excluded = (await getDocs(collection(db, 'couponExclude'))).docs.map((d) => ({ pid: d.id, name: d.data().name as string, teamNumber: d.data().teamNumber as number }))
      .sort((a, b) => a.teamNumber - b.teamNumber || a.name.localeCompare(b.name));
    if (!c?.id) return { coupon: null, winners: [], scratched: 0, excluded };
    const col = collection(db, 'coupons');
    const [ws, notYet] = await Promise.all([
      getDocs(query(col, where('campaignId', '==', c.id), where('win', '==', true))),
      getCountFromServer(query(col, where('campaignId', '==', c.id), where('scratchedAt', '==', null))),
    ]);
    const winners = await Promise.all(ws.docs.map(async (d) => {
      const x = d.data(est); const p = (await getDoc(doc(db, 'participants', x.pid))).data() ?? {};
      return { pid: x.pid, name: p.name ?? '(알 수 없음)', teamNumber: p.teamNumber ?? 0, scratchedAt: iso(x.scratchedAt), claimedAt: iso(x.claimedAt) };
    }));
    winners.sort((a, b) => a.teamNumber - b.teamNumber || a.name.localeCompare(b.name));
    return { coupon: { ...c, deployedAt: isoNow(c.deployedAt) }, winners, scratched: c.eligible - notYet.data().count, excluded };
  }
  if (is('POST', /^\/admin\/coupon\/deploy$/)) {
    const me = await staffOnly();
    const cur = (await readPublic(true)).coupon as CouponDoc | undefined;
    if (cur?.active) fail(409, 'active', '이미 진행 중인 쿠폰이 있습니다. 먼저 마감해 주세요.');
    const count = Number(b.count);
    const title = String(b.title ?? '텀블러').trim().slice(0, 30) || '텀블러';
    if (!Number.isInteger(count) || count < 1 || count > 500) fail(400, 'invalid_count', '당첨 개수를 1 이상의 숫자로 입력해 주세요.');
    const [ps, cs] = await Promise.all([getDocs(collection(db, 'participants')), getDocs(collection(db, 'checkins'))]);
    const inNow = new Set(cs.docs.map((d) => d.id));
    const ex = new Set((await getDocs(collection(db, 'couponExclude'))).docs.map((d) => d.id));
    const pool = ps.docs.filter((d) => d.data().active && inNow.has(d.id)).map((d) => d.id);   // 운영진 포함 입장자 전원
    const canWin = pool.filter((pid) => !ex.has(pid));                                           // 당첨 제외 명단은 꽝 쿠폰만
    if (!pool.length) fail(409, 'nobody', '쿠폰을 받을 입장자가 없습니다.');
    if (count > canWin.length) fail(400, 'too_many', `당첨 개수가 당첨 가능 인원(${canWin.length}명)보다 많습니다.`);
    const order = secureShuffle(canWin.length);
    const win = new Set(order.slice(0, count).map((n) => canWin[n - 1]));
    const id = rid().slice(0, 12);
    await writeChunks(pool.map((pid) => (bt) => bt.set(doc(db, 'coupons', `${id}_${pid}`), { pid, campaignId: id, win: win.has(pid), scratchedAt: null, claimedAt: null })));
    await editPublic(() => ({ coupon: { active: true, id, title, winners: count, eligible: pool.length, deployedAt: Date.now() } }));
    void auditLog(me, 'coupon_deploy', id, { title, winners: count, eligible: pool.length, excluded: pool.length - canWin.length });
    return { ok: true, eligible: pool.length, winners: count };
  }
  if (is('POST', /^\/admin\/coupon\/exclude$/)) {
    // 당첨 제외 명단(관리자만 볼 수 있음)
    const me = await staffOnly();
    const r = await addByNames('couponExclude', String(b.names ?? ''));
    if (r.added.length) void auditLog(me, 'coupon_exclude', null, { count: r.added.length });
    return r;
  }
  // ── 조장: 자기 조 체크인 현황 ──
  if (is('GET', /^\/admin\/leaders$/)) {
    await staffOnly();
    const sn = await getDocs(collection(db, 'leaders'));
    return { people: sn.docs.map((d) => ({ pid: d.id, name: d.data().name as string, teamNumber: d.data().teamNumber as number })).sort((a, b) => a.teamNumber - b.teamNumber || a.name.localeCompare(b.name)) };
  }
  if (is('POST', /^\/admin\/leaders$/)) {
    const me = await staffOnly();
    const r = await addByNames('leaders', String(b.names ?? ''));
    if (r.added.length) void auditLog(me, 'leader_add', null, { names: r.added });
    return r;
  }
  if ((m = is('DELETE', /^\/admin\/leaders\/([^/]+)$/))) {
    const me = await staffOnly(); await deleteDoc(doc(db, 'leaders', m[1])); void auditLog(me, 'leader_remove', m[1]); return { ok: true };
  }
  if (is('GET', /^\/team\/checkins$/)) {
    const me = await currentMe();
    const ld = await getDoc(doc(db, 'leaders', me.pid));
    if (!ld.exists() || ld.data()!.teamNumber !== me.teamNumber) fail(403, 'forbidden', '조장만 볼 수 있습니다.');
    const t = me.teamNumber;
    const [ps, cs] = await Promise.all([
      getDocs(query(collection(db, 'participants'), where('teamNumber', '==', t))),
      getDocs(query(collection(db, 'checkins'), where('teamNumber', '==', t))),
    ]);
    const at = new Map(cs.docs.map((d) => [d.id, isoNow(d.data(est).at)]));
    const people = ps.docs.filter((d) => d.data().active).map((d) => ({ id: d.id, name: d.data().name as string, checkedInAt: at.get(d.id) ?? null }))
      .sort((a, b) => Number(!!a.checkedInAt) - Number(!!b.checkedInAt) || a.name.localeCompare(b.name));
    return { teamNumber: t, total: people.length, checkedIn: people.filter((p) => p.checkedInAt).length, people, generatedAt: new Date().toISOString() };
  }
  if ((m = is('DELETE', /^\/admin\/coupon\/exclude\/([^/]+)$/))) {
    await staffOnly(); await deleteDoc(doc(db, 'couponExclude', m[1])); return { ok: true };
  }
  if (is('POST', /^\/admin\/coupon\/stop$/)) {
    const me = await staffOnly();
    await editPublic((d) => ({ coupon: d.coupon ? { ...d.coupon, active: false } : null }));
    void auditLog(me, 'coupon_stop');
    return { ok: true };
  }
  if (is('POST', /^\/admin\/coupon\/reset$/)) {
    const me = await staffOnly();
    if (b.confirm !== '초기화') fail(400, 'confirm', "확인 문구 '초기화'를 정확히 입력해 주세요.");
    try { await setDoc(doc(db, 'cancelChecks', rid()), { pwHash: await pwHash(String(b.password ?? '')), actorId: me.pid, createdAt: serverTimestamp() }); }
    catch (e) { if (isDenied(e)) fail(403, 'bad_password', '비밀번호가 맞지 않습니다. 아무것도 지워지지 않았습니다.'); throw e; }
    await editPublic(() => ({ coupon: null }));          // 먼저 잠가서 지우는 동안 아무도 긁지 않게
    const all = await getDocs(collection(db, 'coupons'));
    await writeChunks(all.docs.map((d) => (bt) => bt.delete(d.ref)));
    void auditLog(me, 'coupon_reset', null, { removed: all.size });
    return { removed: all.size };
  }
  if ((m = is('POST', /^\/admin\/coupon\/claim\/([^/]+)$/))) {
    const me = await staffOnly();
    const c = (await readPublic(true)).coupon as CouponDoc | undefined;
    if (!c?.id) fail(409, 'no_coupon', '쿠폰 기록이 없습니다.');
    await updateDoc(doc(db, 'coupons', `${c!.id}_${m[1]}`), { claimedAt: b.claimed ? serverTimestamp() : null });
    void auditLog(me, b.claimed ? 'coupon_claim' : 'coupon_unclaim', m[1]);
    return { ok: true };
  }

  if (is('GET', /^\/admin\/scores\/categories$/)) { await staffOnly(); return { categories: CATS.map((c) => ({ ...c, subtypes: c.kind === 'event' ? SUBS : [] })) }; }
  if (is('GET', /^\/admin\/scores\/board$/)) { await staffOnly(); return { teams: await board(), generatedAt: new Date().toISOString() }; }
  if (is('GET', /^\/admin\/scores\/log$/)) {
    await staffOnly();
    const ledger = await readLedger();
    const team = Number(q.get('team')) || 0; const cat = q.get('category'); const actor = q.get('actor'); const st = q.get('status');
    const actors = new Map<string, string>();
    ledger.forEach((e) => { actors.set(e.actorId, e.actorName); if (e.reversal) actors.set(e.reversal.actorId, e.reversal.actorName); });
    return { entries: ledger.filter((e) => (!team || e.teamNumber === team) && (!cat || e.categoryKey === cat) && (!actor || e.actorId === actor || e.reversal?.actorId === actor) && (!st || e.status === st)).slice(0, Number(q.get('limit')) || 300), actors: [...actors].map(([id, name]) => ({ id, name })) };
  }
  if (is('POST', /^\/admin\/scores\/awards$/)) {
    const me = await staffOnly();
    if (!Number.isInteger(b.teamNumber) || b.teamNumber < 1 || b.teamNumber > 8) fail(400, 'invalid_team', '1~8조 중에서 선택해 주세요.');
    if (typeof b.points !== 'number' || !Number.isInteger(b.points) || b.points < 10 || b.points > 200 || b.points % 10) fail(400, 'invalid_points', '점수는 10점부터 200점까지 10점 단위로만 부여할 수 있습니다.');
    const cat = CATS.find((c) => c.key === b.categoryKey); if (!cat) fail(400, 'invalid_category', '종목을 선택해 주세요.');
    const subtypeKey = cat!.kind === 'event' ? b.subtypeKey ?? null : null;
    const reason = String(b.reason ?? '').normalize('NFC').trim();
    const ref = doc(db, 'awards', b.idempotencyKey);
    const prior = await getDoc(ref);
    if (prior.exists()) return { award: { id: ref.id }, replay: true, teams: await board() };
    if (b.confirmDuplicate !== true) {
      const mine = await getDocs(query(collection(db, 'awards'), where('actorId', '==', me.pid)));
      const dup = mine.docs.some((d) => { const x = d.data(est); return Date.now() - (x.createdAt as Timestamp).toMillis() < 60_000 && x.teamNumber === b.teamNumber && x.categoryKey === cat!.key && (x.subtypeKey ?? null) === subtypeKey && x.points === b.points && x.reason === reason; });
      if (dup) fail(409, 'duplicate_warning', `방금 같은 내용(${b.teamNumber}조 · +${b.points}점 · ${reason})을 부여했습니다. 정말 한 번 더 부여할까요?`);
    }
    try {
      await setDoc(ref, { teamNumber: b.teamNumber, categoryKey: cat!.key, subtypeKey, points: b.points, reason, actorId: me.pid, actorName: me.name, createdAt: serverTimestamp() });
    } catch (e) {
      if ((await getDoc(ref).catch(() => null))?.exists()) return { award: { id: ref.id }, replay: true, teams: await board() };
      if (isDenied(e)) fail(400, 'invalid', '입력값을 확인해 주세요. (사유는 이벤트·응원이면 2자 이상)');
      throw e;
    }
    return { award: { id: ref.id }, replay: false, teams: await board() };
  }
  if ((m = is('POST', /^\/admin\/scores\/awards\/([^/]+)\/cancel$/))) {
    const me = await staffOnly();
    const reason = String(b.reason ?? '').trim();
    if (reason.length < 2) fail(400, 'invalid_reason', '취소 사유를 입력해 주세요. (2~200자)');
    const existing = await getDoc(doc(db, 'reversals', m[1]));
    if (existing.exists()) fail(409, 'already_cancelled', `이미 ${existing.data().actorName}님이 취소한 기록입니다. 다시 차감되지 않습니다.`);
    const award = await getDoc(doc(db, 'awards', m[1]));
    if (!award.exists()) fail(404, 'not_found', '점수 기록을 찾을 수 없습니다.');
    const checkId = rid();
    const batch = writeBatch(db);
    batch.set(doc(db, 'cancelChecks', checkId), { pwHash: await pwHash(String(b.password ?? '')), actorId: me.pid, createdAt: serverTimestamp() });
    batch.set(doc(db, 'reversals', m[1]), { awardId: m[1], points: -award.data()!.points, reason, actorId: me.pid, actorName: me.name, checkId, createdAt: serverTimestamp() });
    try { await batch.commit(); } catch (e) {
      const r = await getDoc(doc(db, 'reversals', m[1])).catch(() => null);
      if (r?.exists()) fail(409, 'already_cancelled', `이미 ${r.data()!.actorName}님이 취소한 기록입니다. 다시 차감되지 않습니다.`);
      if (isDenied(e)) fail(403, 'bad_password', '취소 비밀번호가 맞지 않습니다. 점수는 차감되지 않았습니다.');
      throw e;
    }
    return { reversal: { awardId: m[1] }, replay: false, teams: await board() };
  }

  // ── 관리자: 행운권·체크인·인원 ──
  if ((m = is('GET', /^\/admin\/tickets\/([^/]+)$/))) {
    const me = await staffOnly(); const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 1 || n > 100000) fail(400, 'invalid_ticket', '행운권 번호를 숫자로 입력해 주세요.');
    const [t, issued] = await Promise.all([getDoc(doc(db, 'tickets', String(n))), getCountFromServer(collection(db, 'checkins'))]);
    void auditLog(me, 'ticket_lookup', String(n));
    if (!t.exists()) return { issued: issued.data().count, ticket: null };
    const pid = t.data()!.pid as string;
    const [p, c, emp] = await Promise.all([getDoc(doc(db, 'participants', pid)), getDoc(doc(db, 'checkins', pid)), me.role === 'owner' ? getDoc(doc(db, 'employeeIds', pid)) : Promise.resolve(null)]);
    const x = p.data() ?? {};
    return { issued: issued.data().count, ticket: { ticketNumber: n, name: x.name, teamNumber: x.teamNumber, role: x.role, active: x.active, checkedInAt: isoNow(c.data(est)?.at), employeeId: emp?.data()?.employeeId ?? '(owner만 확인)' } };
  }
  if (is('GET', /^\/admin\/checkins$/)) {
    const me = await staffOnly();
    const [ps, cs, emps] = await Promise.all([getDocs(collection(db, 'participants')), getDocs(collection(db, 'checkins')), me.role === 'owner' ? getDocs(collection(db, 'employeeIds')) : Promise.resolve(null)]);
    const ci = new Map(cs.docs.map((d) => [d.id, d.data(est)]));
    const emp = new Map(emps?.docs.map((d) => [d.id, d.data().employeeId as string]) ?? []);
    const people = ps.docs.map((d) => { const x = d.data(); const c = ci.get(d.id); return { id: d.id, name: x.name, employeeId: emp.get(d.id) ?? '비공개', teamNumber: x.teamNumber, role: x.role, active: x.active, ticketNumber: c?.ticket ?? null, checkedInAt: c ? isoNow(c.at) : null }; })
      .sort((a, c) => (a.teamNumber || 9) - (c.teamNumber || 9) || a.name.localeCompare(c.name));
    const act = people.filter((p) => p.active);
    return { teams: [1, 2, 3, 4, 5, 6, 7, 8, 0].map((t) => ({ teamNumber: t, total: act.filter((p) => p.teamNumber === t).length, checkedIn: act.filter((p) => p.teamNumber === t && p.checkedInAt).length })), total: act.length, checkedIn: act.filter((p) => p.checkedInAt).length, people };
  }
  if (is('GET', /^\/admin\/checkins\/summary$/)) {
    // 점수판 화면용 — 조별 개수만 집계 쿼리로(읽기 절약)
    await staffOnly();
    const teams = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 0].map(async (t) => ({
      teamNumber: t,
      total: (await getCountFromServer(query(collection(db, 'participants'), where('teamNumber', '==', t)))).data().count,
      checkedIn: (await getCountFromServer(query(collection(db, 'checkins'), where('teamNumber', '==', t)))).data().count,
    })));
    return { teams, total: teams.reduce((s, t) => s + t.total, 0), checkedIn: teams.reduce((s, t) => s + t.checkedIn, 0), people: [] };
  }
  if (is('POST', /^\/admin\/participants$/)) {
    const me = await staffOnly();
    const name = normalizeName(b.name); const emp = normalizeEmployeeId(b.employeeId);
    if (!name || !emp || emp.length > 64) fail(400, 'invalid', '이름과 사번을 확인해 주세요.');
    if (!isTeam(b.teamNumber)) fail(400, 'invalid_team', '1~8조 또는 운영진 중에서 선택해 주세요.');
    const role: Role = b.role === 'admin' ? 'admin' : 'participant';
    if (role === 'admin' && me.role !== 'owner') fail(403, 'forbidden', '관리자 추가는 owner만 할 수 있습니다. 참가자로 추가해 주세요.');
    const ek = await empKey(emp);
    if ((await getDoc(doc(db, 'empIndex', ek))).exists()) fail(409, 'exists', '이미 명단에 있는 사번입니다.');
    const pid = rid();
    const batch = writeBatch(db);
    batch.set(doc(db, 'participants', pid), { name, teamNumber: b.teamNumber, role, active: true });
    batch.set(doc(db, 'employeeIds', pid), { employeeId: emp });
    batch.set(doc(db, 'loginIndex', await loginKey(emp, name)), { pid });
    batch.set(doc(db, 'empIndex', ek), { pid });
    try { await batch.commit(); } catch (e) { if (isDenied(e)) fail(409, 'exists', '이미 명단에 있는 사번이거나 추가할 수 없습니다.'); throw e; }
    void auditLog(me, 'participant_add', pid, { name, teamNumber: b.teamNumber, role });
    return { uid: pid };
  }

  // ── 관리자: 공지·일정·안내 (config/public 한 문서) ──
  if (is('GET', /^\/admin\/announcements$/)) { await staffOnly(); return { announcements: anns(await readPublic(true), true) }; }
  if (is('POST', /^\/admin\/announcements$/)) {
    await staffOnly();
    const title = String(b.title ?? '').trim(); if (!title || title.length > 80) fail(400, 'invalid_title', '제목을 확인해 주세요. (1~80자)');
    const id = rid(); const now = Date.now();
    await editPublic((d) => ({ announcements: [...(d.announcements ?? []), { id, title, body: String(b.body ?? '').trim().slice(0, 1000), important: !!b.important, published: b.published !== false, createdAt: now, updatedAt: now }] }));
    return { id };
  }
  if ((m = is('PATCH', /^\/admin\/announcements\/([^/]+)$/))) {
    await staffOnly();
    const title = String(b.title ?? '').trim(); if (!title || title.length > 80) fail(400, 'invalid_title', '제목을 확인해 주세요. (1~80자)');
    await editPublic((d) => ({ announcements: (d.announcements ?? []).map((a: any) => (a.id === m![1] ? { ...a, title, body: String(b.body ?? '').trim().slice(0, 1000), important: !!b.important, published: b.published !== false, updatedAt: Date.now() } : a)) }));
    return { ok: true };
  }
  if (is('GET', /^\/admin\/schedule$/)) { await staffOnly(); return { items: items(await readPublic(true), true) }; }
  if ((m = is('PATCH', /^\/admin\/schedule\/([^/]+)$/))) {
    const me = await staffOnly();
    if (!['scheduled', 'time_tbd', 'live', 'done', 'delayed'].includes(b.status)) fail(400, 'invalid_status', '진행 상태를 선택해 주세요.');
    await editPublic((d) => ({ schedule: (d.schedule ?? []).map((i: any) => (i.id === m![1] ? { ...i, title: String(b.title ?? i.title).trim().slice(0, 60), note: String(b.note ?? '').trim().slice(0, 200), startTime: b.startTime || null, endTime: b.endTime || null, status: b.status, delayNote: String(b.delayNote ?? '').trim().slice(0, 120), public: b.public !== false, updatedAt: Date.now() } : i)) }));
    void auditLog(me, 'schedule_update', m[1], { status: b.status });
    return { ok: true };
  }
  if (is('POST', /^\/admin\/schedule$/)) {
    await staffOnly();
    const title = String(b.title ?? '').trim(); if (!title) fail(400, 'invalid_title', '제목을 입력해 주세요.');
    await editPublic((d) => ({ schedule: [...(d.schedule ?? []), { id: rid(), sortOrder: Math.max(0, ...(d.schedule ?? []).map((i: any) => i.sortOrder)) + 10, startTime: b.startTime || null, endTime: b.endTime || null, title, note: String(b.note ?? '').trim(), kind: 'general', status: b.startTime ? 'scheduled' : 'time_tbd', delayNote: '', public: b.public !== false, updatedAt: Date.now() }] }));
    return { ok: true };
  }
  if (is('GET', /^\/admin\/games$/)) return { games: [] };
  if (is('GET', /^\/admin\/event$/)) {
    await staffOnly(); const e = await readPublic(true);
    return { schedulePublished: !!e.schedulePublished, parkingPublished: !!e.parkingPublished, parkingNote: e.parkingNote ?? '', returnBusPublished: !!e.returnBusPublished, returnBusNote: e.returnBusNote ?? '', departureNote: e.departureNote ?? '', statusNote: e.statusNote ?? '', statusNoteUpdatedAt: iso(e.statusNoteUpdatedAt) };
  }
  if (is('PATCH', /^\/admin\/event$/)) {
    const me = await staffOnly();
    await editPublic((e) => {
      const patch: Record<string, unknown> = {};
      for (const k of ['schedulePublished', 'parkingPublished', 'returnBusPublished']) if (typeof b[k] === 'boolean') patch[k] = b[k];
      for (const k of ['parkingNote', 'returnBusNote', 'departureNote']) if (typeof b[k] === 'string') patch[k] = b[k].trim().slice(0, 300);
      if (typeof b.statusNote === 'string' && b.statusNote.trim() !== (e.statusNote ?? '')) { patch.statusNote = b.statusNote.trim().slice(0, 140); patch.statusNoteUpdatedAt = Date.now(); }
      return patch as Partial<PublicDoc>;
    });
    void auditLog(me, 'event_info_update', null, { fields: Object.keys(b) });
    return { ok: true };
  }

  // ── 관리자: 요청·신고·채팅 관리 ──
  if (is('GET', /^\/admin\/help$/)) {
    await staffOnly();
    const s = await getDocs(collection(db, 'help'));
    return { requests: s.docs.map((d) => { const x = d.data(est); return { id: d.id, kind: x.kind, body: x.body, status: x.status, createdAt: isoNow(x.createdAt), updatedAt: isoNow(x.updatedAt), name: x.requesterName, teamNumber: x.requesterTeam }; })
      .sort((a, c) => Number(a.status === 'done') - Number(c.status === 'done') || c.createdAt.localeCompare(a.createdAt)) };
  }
  if ((m = is('PATCH', /^\/admin\/help\/([^/]+)$/))) { await staffOnly(); await updateDoc(doc(db, 'help', m[1]), { status: b.status, updatedAt: serverTimestamp() }); return { ok: true }; }
  if (is('GET', /^\/admin\/reports$/)) {
    await staffOnly();
    const s = await getDocs(collection(db, 'reports'));
    return { reports: s.docs.map((d) => { const x = d.data(est); msgColl.set(x.messageId, chatColl(x.channel)); return { id: d.id, reason: x.reason, status: x.status, createdAt: isoNow(x.createdAt), messageId: x.messageId, channel: x.channel, body: x.body, senderName: x.senderName, senderTeam: x.senderTeam, hidden: false, deleted: false, reporterName: x.reporterName }; })
      .sort((a, c) => Number(a.status !== 'open') - Number(c.status !== 'open') || c.createdAt.localeCompare(a.createdAt)) };
  }
  if ((m = is('PATCH', /^\/admin\/reports\/([^/]+)$/))) { const me = await staffOnly(); await updateDoc(doc(db, 'reports', m[1]), { status: b.status, handledBy: me.pid }); return { ok: true }; }
  if ((m = is('POST', /^\/admin\/chat\/messages\/([^/]+)\/hide$/))) {
    const me = await staffOnly(); const coll = msgColl.get(m[1]);
    if (!coll) fail(404, 'not_found', '메시지를 찾을 수 없습니다. 채팅 화면에서 다시 시도해 주세요.');
    const hidden = b.hidden !== false;
    await updateDoc(doc(db, coll!, m[1]), { hiddenAt: hidden ? serverTimestamp() : null, hiddenBy: me.pid });
    void auditLog(me, hidden ? 'chat_hide' : 'chat_unhide', m[1]);
    return { message: { id: m[1], state: hidden ? 'hidden' : 'ok' } };
  }
  if (is('GET', /^\/admin\/chat\/team\/[^/]+$/)) fail(403, 'forbidden', '무료 요금제 버전에서는 다른 조 채팅을 열람할 수 없습니다.');
  if (is('GET', /^\/admin\/setup-checklist$/)) {
    await staffOnly(); const e = await readPublic(true);
    const total = (await getCountFromServer(collection(db, 'participants'))).data().count;
    return { items: [
      { key: 'roster', label: '실제 참가자 명단 업로드', done: total > 5, detail: `명단 ${total}명` },
      { key: 'cancel_password', label: '점수 취소 비밀번호 운영값 설정', done: false, detail: '명단·권한 → 비밀번호 변경 (기본 1234)' },
      { key: 'schedule', label: '최종 일정 확정 공개', done: !!e.schedulePublished, detail: e.schedulePublished ? '공개됨' : '참가자에게 ‘초안’으로 표시 중' },
      { key: 'parking', label: '주차 안내 확인 후 공개', done: !!e.parkingPublished, detail: e.parkingPublished ? '공개됨' : '미공개' },
      { key: 'return_bus', label: '퇴근버스 탑승 안내 확인', done: !!e.returnBusPublished && !!e.returnBusNote, detail: e.returnBusNote || '미입력' },
      { key: 'rules', label: '경기별 동률·교체·실패 기준 확정', done: false, detail: '현장 심판 브리핑에서 확정 (앱 자동채점 없음)' },
    ] };
  }

  // ── owner: 명단·권한·초기화 ──
  if ((m = is('POST', /^\/owner\/roster\/(preview|commit)$/))) {
    const me = await staffOnly(true);
    const plan = await planRoster(me, String(b.csv ?? ''));
    if (m[1] === 'preview') return plan.summary;
    if (plan.summary.errors.length) fail(422, 'roster_invalid', '오류가 있는 행이 있어 전체 반영을 중단했습니다.');
    if (plan.summary.roleChanges.length && b.confirmRoleChanges !== true) fail(409, 'role_change_confirmation', '역할 변경이 포함되어 있습니다. 변경 내용을 확인한 뒤 다시 반영해 주세요.');
    await writeChunks(plan.ops);
    void auditLog(me, 'roster_import', null, { inserted: plan.summary.inserts, updated: plan.summary.updates.length });
    return { inserted: plan.summary.inserts, updated: plan.summary.updates.length, unchanged: plan.summary.unchanged };
  }
  if ((m = is('POST', /^\/owner\/participants\/([^/]+)\/role$/))) {
    const me = await staffOnly(true);
    if (m[1] === me.pid) fail(400, 'self_role', '본인의 역할은 바꿀 수 없습니다. 다른 owner에게 요청해 주세요.');
    if (!['participant', 'admin', 'owner'].includes(b.role)) fail(400, 'invalid_role', '역할 값이 올바르지 않습니다.');
    const cur = (await getDoc(doc(db, 'participants', m[1]))).data();
    if (!cur) fail(404, 'not_found', '참가자를 찾을 수 없습니다.');
    await updateDoc(doc(db, 'participants', m[1]), { role: b.role });
    void auditLog(me, 'role_change', m[1], { name: cur!.name, from: cur!.role, to: b.role });
    return { from: cur!.role, to: b.role };
  }
  if ((m = is('POST', /^\/owner\/participants\/([^/]+)\/team$/))) {
    const me = await staffOnly(true);
    if (!isTeam(b.teamNumber)) fail(400, 'invalid_team', '1~8조 또는 운영진 중에서 선택해 주세요.');
    const reason = String(b.reason ?? '').trim(); if (reason.length < 2) fail(400, 'invalid_reason', '조 변경 사유를 입력해 주세요.');
    const cur = (await getDoc(doc(db, 'participants', m[1]))).data();
    if (!cur) fail(404, 'not_found', '참가자를 찾을 수 없습니다.');
    const batch = writeBatch(db);
    batch.update(doc(db, 'participants', m[1]), { teamNumber: b.teamNumber });
    if ((await getDoc(doc(db, 'checkins', m[1]))).exists()) batch.update(doc(db, 'checkins', m[1]), { teamNumber: b.teamNumber });
    await batch.commit();
    void auditLog(me, 'team_change', m[1], { name: cur!.name, from: cur!.teamNumber, to: b.teamNumber, reason });
    return { from: cur!.teamNumber, to: b.teamNumber };
  }
  if (is('POST', /^\/owner\/tickets\/reset$/)) {
    const me = await staffOnly(true);
    if (b.confirm !== '초기화') fail(400, 'confirm', "확인 문구 '초기화'를 정확히 입력해 주세요.");
    try { await setDoc(doc(db, 'cancelChecks', rid()), { pwHash: await pwHash(String(b.password ?? '')), actorId: me.pid, createdAt: serverTimestamp() }); }
    catch (e) { if (isDenied(e)) fail(403, 'bad_password', '비밀번호가 맞지 않습니다. 아무것도 지워지지 않았습니다.'); throw e; }
    const removed = await resetTickets();
    void auditLog(me, 'tickets_reset', null, { removed });
    return { removed };
  }
  if (is('GET', /^\/owner\/result$/)) {
    // 행사 결과 모으기 — 초기화로 지워졌어도 남는 기록(접속 연결·감사 로그·명단)까지 함께 본다
    await staffOnly(true);
    const all = (c: string) => getDocs(collection(db, c)).catch(() => null);
    const [ps, emps, cis, bds, aud, cps, tks] = await Promise.all([
      getDocs(collection(db, 'participants')), all('employeeIds'), all('checkins'), all('bindings'),
      getDocs(query(collection(db, 'audit'), orderBy('createdAt', 'asc'))), all('coupons'), all('tickets'),
    ]);
    const ms = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : null);
    const emp = new Map(emps?.docs.map((d) => [d.id, d.data().employeeId as string]) ?? []);
    const ci = new Map(cis?.docs.map((d) => [d.id, d.data(est)]) ?? []);
    const seen = new Map<string, number>();                       // 이 기기로 입장(로그인)한 기록
    bds?.docs.forEach((d) => { const x = d.data(est); const t = ms(x.createdAt); if (x.pid && t) seen.set(x.pid, Math.min(seen.get(x.pid) ?? t, t)); });
    const audits = aud.docs.map((d) => { const x = d.data(est); return { at: ms(x.createdAt) ?? 0, action: x.action as string, target: (x.target ?? null) as string | null, actor: x.actorName as string, detail: x.detail }; });
    const owners = new Map<number, string>();                     // 행운권 번호 → pid
    tks?.docs.forEach((d) => owners.set(Number(d.id), d.data().pid));
    cis?.docs.forEach((d) => { if (!owners.has(d.data().ticket)) owners.set(d.data().ticket, d.id); });
    const lookups = audits.filter((a) => a.action === 'ticket_lookup').map((a) => ({ n: Number(a.target), at: a.at }));
    const drawn = new Map<string, { n: number; at: number }>();
    const unmatched: { n: number; at: number }[] = [];
    for (const l of lookups) { const pid = owners.get(l.n); if (pid) { if (!drawn.has(pid)) drawn.set(pid, l); } else unmatched.push(l); }
    const couponWin = new Map<string, { claimed: boolean }>();
    cps?.docs.forEach((d) => { const x = d.data(); if (x.win) couponWin.set(x.pid, { claimed: !!x.claimedAt || couponWin.get(x.pid)?.claimed === true }); });
    audits.filter((a) => a.action === 'coupon_claim' && a.target).forEach((a) => couponWin.set(a.target!, { claimed: true }));
    const rows = ps.docs.map((d) => {
      const x = d.data(); const c = ci.get(d.id);
      const first = Math.min(ms(c?.at) ?? Infinity, seen.get(d.id) ?? Infinity);
      return {
        id: d.id, employeeId: emp.get(d.id) ?? '', name: x.name as string, teamNumber: x.teamNumber as number, role: x.role as string, active: !!x.active,
        attended: Number.isFinite(first), firstAt: Number.isFinite(first) ? new Date(first).toISOString() : null,
        ticket: (c?.ticket as number | undefined) ?? null, drawnAt: drawn.get(d.id) ? new Date(drawn.get(d.id)!.at).toISOString() : null,
        couponWin: couponWin.has(d.id), couponClaimed: couponWin.get(d.id)?.claimed ?? false,
      };
    }).sort((a, b) => (a.teamNumber || 9) - (b.teamNumber || 9) || a.name.localeCompare(b.name));
    const resets = audits.filter((a) => ['reset_all', 'tickets_reset', 'coupon_reset'].includes(a.action)).map((a) => ({ at: new Date(a.at).toISOString(), action: a.action, actor: a.actor, detail: a.detail }));
    return {
      rows, resets, unmatched: unmatched.map((u) => ({ n: u.n, at: new Date(u.at).toISOString() })),
      counts: { checkins: cis?.size ?? 0, bindings: bds?.size ?? 0, lookups: lookups.length, coupons: cps?.size ?? 0, audit: audits.length },
    };
  }
  if (is('POST', /^\/owner\/reset-all$/)) {
    // 행사 시작 전 전체 초기화 — 명단·권한·공지·일정·당첨 제외·조장 지정은 그대로
    const me = await staffOnly(true);
    if (b.confirm !== '초기화') fail(400, 'confirm', "확인 문구 '초기화'를 정확히 입력해 주세요.");
    const want = { scores: true, tickets: true, coupons: true, chat: true, help: true, ...(b.parts ?? {}) } as Record<string, boolean>;
    if (!Object.values(want).some(Boolean)) fail(400, 'nothing', '초기화할 항목을 하나 이상 선택해 주세요.');
    try { await setDoc(doc(db, 'cancelChecks', rid()), { pwHash: await pwHash(String(b.password ?? '')), actorId: me.pid, createdAt: serverTimestamp() }); }
    catch (e) { if (isDenied(e)) fail(403, 'bad_password', '비밀번호가 맞지 않습니다. 아무것도 지워지지 않았습니다.'); throw e; }
    const done: Record<string, number> = {};
    const wipe = async (cols: string[]) => {
      let n = 0;
      for (const col of cols) { const sn = await getDocs(collection(db, col)); n += sn.size; await writeChunks(sn.docs.map((d) => (bt) => bt.delete(d.ref))); }
      return n;
    };
    if (want.coupons) { await editPublic(() => ({ coupon: null })); done.coupons = await wipe(['coupons']); }
    if (want.scores) done.scores = await wipe(['reversals', 'awards']);
    if (want.chat) { await editPublic(() => ({ chatResetAt: serverTimestamp() })); done.chat = await wipe(['reports']); }
    if (want.help) done.help = await wipe(['help']);
    if (want.tickets) done.tickets = await resetTickets();
    void auditLog(me, 'reset_all', null, done);
    return { done };
  }
  if (is('POST', /^\/owner\/cancel-password$/)) {
    await staffOnly(true);
    const pw = String(b.password ?? '');
    if (pw.length < 4) fail(400, 'too_short', '비밀번호는 4자 이상으로 정해 주세요.');
    await updateDoc(doc(db, 'private', 'settings'), { cancelHash: await pwHash(pw) });
    return { ok: true };
  }
  if (is('GET', /^\/owner\/audit$/)) {
    await staffOnly(true);
    const s = await getDocs(query(collection(db, 'audit'), orderBy('createdAt', 'desc'), limit(300)));
    return { events: s.docs.map((d) => { const x = d.data(est); return { id: d.id, actorName: x.actorName, action: x.action, target: x.target, detail: x.detail, createdAt: isoNow(x.createdAt) }; }) };
  }
  return fail(404, 'not_found', '지원하지 않는 기능입니다.');
}

/** 명단 CSV 계획: Cloud Functions 버전과 같은 병합 정책 */
async function planRoster(actor: Me, text: string) {
  if (!text.trim()) fail(400, 'empty_csv', 'CSV 파일 내용을 확인해 주세요.');
  const { rows, errors } = parseRoster(text);
  const [ps, ids, cis] = await Promise.all([getDocs(collection(db, 'participants')), getDocs(collection(db, 'employeeIds')), getDocs(collection(db, 'checkins'))]);
  const empOf = new Map(ids.docs.map((x) => [x.id, x.data().employeeId as string]));
  const checked = new Set(cis.docs.map((x) => x.id));
  const byEmp = new Map(ps.docs.map((x) => [(empOf.get(x.id) ?? '').toLowerCase(), { pid: x.id, emp: empOf.get(x.id) ?? '', ...(x.data() as { name: string; teamNumber: number; role: Role; active: boolean }) }]));
  const inserts: typeof rows = []; const updates: { row: (typeof rows)[number]; pid: string; old: { name: string; emp: string }; changes: string[] }[] = [];
  const roleChanges: { line: number; name: string; from: Role; to: Role }[] = []; let unchanged = 0;
  for (const row of rows) {
    const cur = byEmp.get(row.employeeId.toLowerCase());
    if (!cur) { inserts.push(row); continue; }
    if (cur.emp !== row.employeeId) { errors.push({ line: row.line, reason: '기존 사번과 대소문자만 다릅니다' }); continue; }
    const changes: string[] = [];
    if (cur.name !== row.name) changes.push('이름');
    if (cur.active !== row.active) changes.push(row.active ? '활성화' : '비활성화');
    if (cur.teamNumber !== row.teamNumber) {
      if (checked.has(cur.pid)) { errors.push({ line: row.line, reason: `체크인한 참가자의 조 변경은 업로드로 할 수 없습니다. '조 변경'을 사용하세요` }); continue; }
      changes.push(`조 ${teamLabel(cur.teamNumber)}→${teamLabel(row.teamNumber)}`);
    }
    if (cur.role === 'owner' && row.role !== 'owner') row.role = 'owner'; // owner는 업로드로 강등하지 않음
    if (cur.role !== row.role) {
      if (cur.pid === actor.pid) { errors.push({ line: row.line, reason: '본인의 역할은 업로드로 바꿀 수 없습니다' }); continue; }
      roleChanges.push({ line: row.line, name: row.name, from: cur.role, to: row.role }); changes.push(`역할 ${cur.role}→${row.role}`);
    }
    if (cur.pid === actor.pid && !row.active) { errors.push({ line: row.line, reason: '본인을 비활성화할 수 없습니다' }); continue; }
    if (changes.length) updates.push({ row, pid: cur.pid, old: { name: cur.name, emp: cur.emp }, changes }); else unchanged++;
  }
  errors.sort((a, c) => a.line - c.line);
  const ops: ((bt: ReturnType<typeof writeBatch>) => void)[] = [];
  for (const r of inserts) {
    const pid = rid(); const lk = await loginKey(r.employeeId, r.name); const ek = await empKey(r.employeeId);
    ops.push((bt) => bt.set(doc(db, 'participants', pid), { name: r.name, teamNumber: r.teamNumber, role: r.role, active: r.active }));
    ops.push((bt) => bt.set(doc(db, 'employeeIds', pid), { employeeId: r.employeeId }));
    ops.push((bt) => bt.set(doc(db, 'loginIndex', lk), { pid }));
    ops.push((bt) => bt.set(doc(db, 'empIndex', ek), { pid }));
  }
  for (const u of updates) {
    ops.push((bt) => bt.update(doc(db, 'participants', u.pid), { name: u.row.name, teamNumber: u.row.teamNumber, role: u.row.role, active: u.row.active }));
    if (u.old.name !== u.row.name) {
      const oldKey = await loginKey(u.old.emp, u.old.name); const newKey = await loginKey(u.row.employeeId, u.row.name);
      ops.push((bt) => bt.delete(doc(db, 'loginIndex', oldKey)));
      ops.push((bt) => bt.set(doc(db, 'loginIndex', newKey), { pid: u.pid }));
    }
  }
  return {
    ops,
    summary: {
      inserts: inserts.length, updates: updates.map((x) => ({ line: x.row.line, name: x.row.name, teamNumber: x.row.teamNumber, changes: x.changes })),
      roleChanges, unchanged, untouchedExisting: ps.size - updates.length - unchanged, errors,
      sample: inserts.slice(0, 5).map((r) => ({ line: r.line, name: r.name, teamNumber: r.teamNumber, role: r.role, active: r.active })),
    },
  };
}

/** 최초 설정: 공개 문서·비밀번호 설정·행운권 풀·첫 owner를 한 번에 만든다 (config/public이 없을 때만 규칙이 허용) */
export async function bootstrap(input: { name: string; employeeId: string; teamNumber: number }) {
  const name = normalizeName(input.name); const emp = normalizeEmployeeId(input.employeeId);
  if (!name || !emp || !isTeam(input.teamNumber)) fail(400, 'invalid', '이름·사번·조를 확인해 주세요.');
  const user = await deviceUser();
  if ((await getDoc(doc(db, 'config', 'public'))).exists()) fail(409, 'done', '이미 설정이 끝났습니다. 첫 화면에서 owner 이름·사번으로 입장해 주세요.');
  const pid = rid(); const now = Date.now();
  const key = await loginKey(emp, name);
  const batch = writeBatch(db);
  batch.set(doc(db, 'config', 'public'), {
    title: '2026 하이테크본부 가을운동회', date: '2026-10-21', venue: '이충동 부락산 분수공원 야외공연장',
    schedulePublished: false, parkingPublished: false,
    parkingNote: '자차 이용 시 이충문화체육센터 주차장. 원문 안내: 3시간 무료, 초과 요금은 개인 부담(지원 없음).',
    returnBusPublished: true, returnBusNote: RETURN_BUS_NOTE,
    departureNote: '기존 귀향/퇴근버스 탑승지에서 출발합니다. 버스 4대 2회 운행 예정이며 배차는 별도 안내됩니다.',
    statusNote: '', statusNoteUpdatedAt: null, updatedAt: serverTimestamp(),
    schedule: SCHEDULE.map(([startTime, endTime, title, note, kind, , status], i) => ({ id: rid(), sortOrder: (i + 1) * 10, startTime, endTime, title, note, kind, status, delayNote: '', public: true, updatedAt: now })),
    announcements: [],
  });
  batch.set(doc(db, 'private', 'settings'), { cancelHash: await pwHash('1234') });
  secureShuffle(300).forEach((n, i) => batch.set(doc(db, 'pool', String(i + 1)), { n }));
  batch.set(doc(db, 'participants', pid), { name, teamNumber: input.teamNumber, role: 'owner', active: true });
  batch.set(doc(db, 'employeeIds', pid), { employeeId: emp });
  batch.set(doc(db, 'loginIndex', key), { pid });
  batch.set(doc(db, 'empIndex', await empKey(emp)), { pid });
  batch.set(doc(db, 'bindings', user.uid), { pid, key, createdAt: serverTimestamp() });
  batch.set(doc(db, 'audit', rid()), { actorId: pid, actorName: name, action: 'event_initialized', target: null, detail: { ticketPool: 300 }, createdAt: serverTimestamp() });
  try { await batch.commit(); } catch (e) { throw toApiError(e); }
}

/** CSV 내보내기 */
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
    const [ps, ids, cs] = await Promise.all([getDocs(collection(db, 'participants')), getDocs(collection(db, 'employeeIds')), getDocs(collection(db, 'checkins'))]);
    const emp = new Map(ids.docs.map((d) => [d.id, d.data().employeeId])); const ci = new Map(cs.docs.map((d) => [d.id, d.data(est)]));
    void auditLog(me, 'export_checkins');
    return { name: 'checkins.csv', csv: csv(['사번', '이름', '조', '역할', '활성', '체크인순번', '행운권', '체크인시각(KST)'],
      ps.docs.map((d) => { const x = d.data(); const c = ci.get(d.id); return [emp.get(d.id) ?? '', x.name, teamLabel(x.teamNumber), x.role, x.active ? 'Y' : 'N', c?.seq ?? '', c ? String(c.ticket).padStart(3, '0') : '', kst(iso(c?.at))]; })) };
  }
  const s = await getDocs(query(collection(db, 'audit'), orderBy('createdAt', 'asc')));
  return { name: 'audit.csv', csv: csv(['시각(KST)', '수행자', '동작', '대상', '상세'], s.docs.map((d) => { const x = d.data(est); return [kst(isoNow(x.createdAt)), x.actorName, x.action, x.target ?? '', JSON.stringify(x.detail ?? {})]; })) };
}
