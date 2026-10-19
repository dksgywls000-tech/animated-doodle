/**
 * 브라우저 데모용 가짜 API — 실제 앱의 client/src/api.ts와 같은 함수를 내보낸다.
 * 서버 규칙(로그인 검증, 행운권 정책, 점수 10~200, 취소 1회, 채팅 조 제한 등)을 흉내 내지만
 * 모든 데이터가 이 브라우저에만 있으므로 보안·공유 기능은 없다.
 */
import { load, save, session, rid, now, CATS, SUBS, SEAT_NOTES, CANCEL_PASSWORD, type State, type P, type Msg } from './store';
import { realtime } from './realtime';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, any> = {}) { super(message); }
  get unknownOutcome() { return this.status === 0; }
}
export const setCsrf = (_t: string) => {};
export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');

const LOGIN_FAILED = '이름과 사번을 확인해 주세요. 계속 안 되면 운영진에게 문의해 주세요.';
const fail = (status: number, code: string, message: string, extra: Record<string, any> = {}): never => { throw new ApiError(status, code, message, extra); };
const pub = (channel: string, type: string, data?: unknown, participantId?: string) => realtime.publish({ channel, type, data, participantId });
const isStaff = (p: P) => p.role !== 'participant';
const mask = (id: string) => (id.length <= 2 ? '**' : id.slice(0, 2) + '*'.repeat(Math.max(1, id.length - 4)) + id.slice(-2));
const audit = (s: State, actor: P | null, action: string, target: string | null = null, detail: unknown = {}) =>
  s.audit.unshift({ id: (s.audit[0]?.id ?? 0) + 1, actorName: actor?.name ?? null, action, target, detail, createdAt: now() });

export async function api<T = any>(method: string, url: string, body?: any): Promise<T> {
  await new Promise((r) => setTimeout(r, 60)); // 네트워크 느낌
  if (!navigator.onLine) throw new ApiError(0, 'network', '네트워크 연결이 불안정합니다. 연결을 확인한 뒤 다시 시도해 주세요.');
  const s = load();
  try {
    const out = route(s, method, url, body ?? {});
    save(s);
    return out as T;
  } catch (e) {
    save(s); // 실패 시도 기록 등
    if (e instanceof ApiError && e.status === 401) window.dispatchEvent(new CustomEvent('fd:unauthenticated'));
    throw e;
  }
}

function me(s: State): P {
  const id = session.get();
  const p = s.participants.find((x) => x.id === id && x.active);
  if (!p) fail(401, 'unauthenticated', '로그인이 필요합니다. 이름과 사번으로 다시 입장해 주세요.');
  return p!;
}
function admin(s: State): P { const p = me(s); if (!isStaff(p)) fail(403, 'forbidden', '관리자만 사용할 수 있습니다.'); return p; }
function owner(s: State): P { const p = me(s); if (p.role !== 'owner') fail(403, 'forbidden', 'owner만 사용할 수 있습니다.'); return p; }

// ── 시간: 데모에서는 '행사 당일 HH:MM'으로 가정할 수 있다 ──
function kstMinutes(s: State): { date: string; minutes: number } {
  if (s.clock !== 'real') { const [h, m] = s.clock.split(':').map(Number); return { date: '2026-10-21', minutes: h * 60 + m }; }
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, minutes: Number(g('hour')) * 60 + Number(g('minute')) };
}
const hm = (t: string | null) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null);

function nowNext(s: State, items: State['schedule']) {
  const k = kstMinutes(s);
  const live = items.filter((i) => i.status === 'live');
  let currentIds: string[] = []; let basis = 'none'; let anchor = -Infinity;
  if (live.length) { currentIds = live.map((i) => i.id); basis = 'manual'; anchor = Math.max(...live.map((i) => i.sortOrder)); }
  else if (k.date === '2026-10-21') {
    basis = 'time';
    const cur = items.filter((i) => { const a = hm(i.startTime), b = hm(i.endTime); return i.status !== 'done' && i.status !== 'time_tbd' && a !== null && b !== null && a <= k.minutes && k.minutes < b; });
    if (cur.length) { currentIds = cur.map((i) => i.id); anchor = Math.max(...cur.map((i) => i.sortOrder)); }
    else { const st = items.filter((i) => { const a = hm(i.startTime); return a !== null && a <= k.minutes; }); if (st.length) anchor = Math.max(...st.map((i) => i.sortOrder)); }
  }
  const isEventDay = k.date === '2026-10-21'; const beforeEvent = k.date < '2026-10-21';
  const next = items.find((i) => i.sortOrder > anchor && !currentIds.includes(i.id) && i.status !== 'done');
  return { currentIds, nextId: isEventDay || basis === 'manual' ? next?.id ?? null : beforeEvent ? items.find((i) => i.status !== 'done')?.id ?? null : null, basis, serverTime: now(), isEventDay, beforeEvent };
}

const eventInfo = (s: State) => ({
  title: '2026 하이테크본부 가을운동회', date: '2026-10-21', venue: '이충동 부락산 분수공원 야외공연장',
  departureNote: s.event.departureNote, parking: s.event.parkingPublished ? s.event.parkingNote : null,
  returnBus: s.event.returnBusPublished && s.event.returnBusNote ? s.event.returnBusNote : null,
  statusNote: s.event.statusNote || null, statusNoteUpdatedAt: s.event.statusNoteUpdatedAt, schedulePublished: s.event.schedulePublished,
});
const anns = (s: State, viewer: string, all = false) => s.announcements.filter((a) => all || a.published)
  .sort((a, b) => Number(b.important) - Number(a.important) || b.createdAt.localeCompare(a.createdAt))
  .map(({ reads, ...a }) => ({ ...a, read: reads.includes(viewer) }));
const sched = (s: State, all = false) => s.schedule.filter((i) => all || i.public).sort((a, b) => a.sortOrder - b.sortOrder);
const pubMsg = (m: Msg, viewer?: string) => ({
  id: m.id, channel: m.channel, senderId: m.senderId, senderName: m.senderName, senderTeam: m.senderTeam, staff: m.staff,
  body: m.hiddenAt || m.deletedAt ? null : m.body, state: m.hiddenAt ? 'hidden' : m.deletedAt ? 'deleted' : 'ok', createdAt: m.createdAt,
  ...(viewer === m.senderId ? { clientMsgId: m.clientMsgId } : {}),
});
const wsCh = (ch: string) => (ch === 'all' ? 'chat:all' : `chat:${ch}`);

function board(s: State) {
  const teams = Array.from({ length: 8 }, (_, i) => {
    const t = i + 1;
    const aw = s.awards.filter((a) => a.teamNumber === t);
    const total = aw.reduce((x, a) => x + a.points, 0) + s.reversals.filter((r) => aw.some((a) => a.id === r.awardId)).reduce((x, r) => x + r.points, 0);
    return { teamNumber: t, name: `${t}조`, total, activeAwards: aw.filter((a) => !s.reversals.some((r) => r.awardId === a.id)).length };
  });
  return teams.map((t) => ({ ...t, rank: 1 + teams.filter((o) => o.total > t.total).length }));
}

function log(s: State, q: URLSearchParams) {
  const team = Number(q.get('team')) || 0; const cat = q.get('category'); const actor = q.get('actor'); const status = q.get('status');
  const limit = Number(q.get('limit')) || 300;
  return s.awards.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((a) => {
    const r = s.reversals.find((x) => x.awardId === a.id);
    return {
      id: a.id, teamNumber: a.teamNumber, categoryKey: a.categoryKey, categoryLabel: CATS.find((c) => c.key === a.categoryKey)!.label,
      subtypeKey: a.subtypeKey, subtypeLabel: SUBS.find((x) => x.key === a.subtypeKey)?.label ?? null, points: a.points, reason: a.reason,
      actorId: a.actorId, actorName: a.actorName, createdAt: a.createdAt, status: r ? 'cancelled' : 'active',
      reversal: r ? { id: r.id, points: r.points, reason: r.reason, actorId: r.actorId, actorName: r.actorName, createdAt: r.createdAt } : null,
    };
  }).filter((e) => (!team || e.teamNumber === team) && (!cat || e.categoryKey === cat) && (!actor || e.actorId === actor || e.reversal?.actorId === actor)
    && (!status || e.status === status)).slice(0, limit);
}

function checkin(s: State, p: P) {
  const ex = s.checkins.find((c) => c.participantId === p.id);
  if (ex) return { ...ex, isNew: false };
  const seq = s.nextSeq;
  const ticket = seq <= 300 ? s.pool[seq - 1] : seq;
  const c = { participantId: p.id, seq, ticket, at: now() };
  s.checkins.push(c); s.nextSeq = seq + 1;
  return { ...c, isNew: true };
}

function resolveChannel(p: P, ch: string) {
  if (ch === 'all') return 'all';
  if (ch === 'team') return `team:${p.teamNumber}`;
  const m = /^team:([1-8])$/.exec(ch);
  if (m) { if (Number(m[1]) !== p.teamNumber) fail(403, 'forbidden_channel', '다른 조 채팅방에는 들어갈 수 없습니다.'); return ch; }
  return fail(400, 'invalid_channel', '채팅방을 찾을 수 없습니다.');
}

const str = (v: unknown, max: number, min = 0) => {
  const x = typeof v === 'string' ? v.trim() : '';
  if (x.length < min || x.length > max) fail(400, 'invalid', `입력 값을 확인해 주세요. (${min}~${max}자)`);
  return x;
};

function route(s: State, method: string, url: string, b: any): unknown {
  const u = new URL(url, 'http://demo');
  const path = u.pathname.replace(/^\/api/, '');
  const q = u.searchParams;
  const M = (m: string, re: RegExp) => (method === m ? re.exec(path) : null);
  let m: RegExpExecArray | null;

  // ── 공개·로그인 ──
  if (M('GET', /^\/public\/event$/)) return { title: '2026 하이테크본부 가을운동회', date: '2026-10-21', venue: '이충동 부락산 분수공원 야외공연장', demo: true };
  if (M('POST', /^\/login$/)) {
    const name = String(b.name ?? '').normalize('NFC').trim(); const emp = String(b.employeeId ?? '').normalize('NFC').trim();
    const p = s.participants.find((x) => x.employeeId === emp && x.name === name);
    if (!p || !p.active) fail(401, 'login_failed', LOGIN_FAILED);
    const c = checkin(s, p!);
    session.set(p!.id);
    return { ok: true, isNewCheckin: c.isNew, csrfToken: 'demo' };
  }
  if (M('POST', /^\/logout$/)) { session.set(null); return { ok: true }; }
  if (M('GET', /^\/me$/)) {
    const p = me(s); const c = s.checkins.find((x) => x.participantId === p.id) ?? (checkin(s, p), s.checkins.find((x) => x.participantId === p.id));
    return { id: p.id, name: p.name, employeeIdMasked: mask(p.employeeId), teamNumber: p.teamNumber, teamName: p.teamNumber === 0 ? '운영진' : `${p.teamNumber}조`, seatNote: SEAT_NOTES[p.teamNumber],
      ticketNumber: c?.ticket ?? null, checkedInAt: c?.at ?? null, isStaff: isStaff(p), role: p.role, csrfToken: 'demo', demo: true };
  }
  if (M('GET', /^\/home$/)) {
    const p = me(s); const items = sched(s); const nn = nowNext(s, items);
    return { event: eventInfo(s), nowNext: nn, current: items.filter((i) => nn.currentIds.includes(i.id)), next: items.find((i) => i.id === nn.nextId) ?? null, announcements: anns(s, p.id).slice(0, 5) };
  }
  if (M('GET', /^\/schedule$/)) { me(s); const items = sched(s); return { event: eventInfo(s), items, nowNext: nowNext(s, items), lastUpdated: items.reduce((x, i) => (i.updatedAt > x ? i.updatedAt : x), s.event.updatedAt) }; }
  if (M('GET', /^\/games$/)) { me(s); return { games: s.games.filter((g) => g.published) }; }
  if (M('GET', /^\/announcements$/)) { const p = me(s); return { announcements: anns(s, p.id) }; }
  if ((m = M('POST', /^\/announcements\/([^/]+)\/read$/))) { const p = me(s); const a = s.announcements.find((x) => x.id === m![1]); if (a && !a.reads.includes(p.id)) a.reads.push(p.id); return { ok: true }; }

  // ── 도움 요청 ──
  if (M('GET', /^\/help$/)) { const p = me(s); return { requests: s.help.filter((h) => h.requesterId === p.id).sort((a, c) => c.createdAt.localeCompare(a.createdAt)) }; }
  if (M('POST', /^\/help$/)) {
    const p = me(s);
    if (!['route', 'supplies', 'other'].includes(b.kind)) fail(400, 'invalid_kind', '요청 종류를 선택해 주세요.');
    const prior = s.help.find((h) => h.requesterId === p.id && h.clientReqId === b.clientReqId);
    if (prior) return { request: prior };
    if (s.help.filter((h) => h.requesterId === p.id && h.status !== 'done').length >= 3) fail(429, 'too_many_open', '처리 중인 요청이 3개 있습니다. 급하면 운영지원 부스로 직접 와 주세요.');
    const h = { id: rid(), requesterId: p.id, kind: b.kind, body: str(b.body, 300, b.kind === 'other' ? 2 : 0), status: 'open', clientReqId: b.clientReqId, createdAt: now(), updatedAt: now() };
    s.help.push(h); pub('admin', 'help_changed');
    return { request: h };
  }

  // ── 채팅 ──
  if (M('GET', /^\/chat\/unread$/)) {
    const p = me(s);
    const count = (ch: string) => Math.min(99, s.messages.filter((x) => x.channel === ch && x.senderId !== p.id && !x.deletedAt && !x.hiddenAt && x.createdAt > (s.reads[`${p.id}|${ch}`] ?? '')).length);
    return { all: count('all'), team: count(`team:${p.teamNumber}`) };
  }
  if ((m = M('GET', /^\/chat\/([^/]+)\/messages$/))) {
    const p = me(s); const ch = resolveChannel(p, decodeURIComponent(m[1]));
    const list = s.messages.filter((x) => x.channel === ch).sort((a, c) => a.createdAt.localeCompare(c.createdAt)).slice(-100);
    return { channel: ch, messages: list.map((x) => pubMsg(x, p.id)), nextCursor: null };
  }
  if ((m = M('POST', /^\/chat\/([^/]+)\/messages$/))) {
    const p = me(s); const ch = resolveChannel(p, decodeURIComponent(m[1]));
    const prior = s.messages.find((x) => x.senderId === p.id && x.clientMsgId === b.clientMsgId);
    if (prior) return { message: pubMsg(prior, p.id), replay: true };
    const body = String(b.body ?? '').trim();
    if (!body) fail(400, 'empty_message', '메시지를 입력해 주세요.');
    if (body.length > 500) fail(400, 'message_too_long', '메시지는 500자까지 보낼 수 있습니다.');
    const recent = s.messages.filter((x) => x.senderId === p.id && Date.now() - Date.parse(x.createdAt) < 10_000).length;
    if (recent >= 5) fail(429, 'flood', '메시지를 너무 빠르게 보내고 있어요. 잠시 후 다시 보내 주세요.');
    const msg: Msg = { id: rid(), channel: ch, senderId: p.id, senderName: p.name, senderTeam: p.teamNumber, staff: isStaff(p), body, clientMsgId: b.clientMsgId, createdAt: now(), deletedAt: null, hiddenAt: null };
    s.messages.push(msg); pub(wsCh(ch), 'chat_message', pubMsg(msg));
    return { message: pubMsg(msg, p.id), replay: false };
  }
  if ((m = M('POST', /^\/chat\/([^/]+)\/read$/))) { const p = me(s); s.reads[`${p.id}|${resolveChannel(p, m[1])}`] = now(); return { ok: true }; }
  if ((m = M('DELETE', /^\/chat\/messages\/([^/]+)$/))) {
    const p = me(s); const x = s.messages.find((y) => y.id === m![1]);
    if (!x) fail(404, 'not_found', '메시지를 찾을 수 없습니다.');
    if (x!.senderId !== p.id) fail(403, 'not_owner', '내가 보낸 메시지만 삭제할 수 있습니다.');
    x!.deletedAt ??= now(); pub(wsCh(x!.channel), 'chat_update', pubMsg(x!));
    return { message: pubMsg(x!, p.id) };
  }
  if ((m = M('POST', /^\/chat\/messages\/([^/]+)\/report$/))) {
    const p = me(s); const x = s.messages.find((y) => y.id === m![1]);
    if (!x || (x.channel !== 'all' && x.channel !== `team:${p.teamNumber}`)) fail(404, 'not_found', '메시지를 찾을 수 없습니다.');
    if (!s.reports.some((r) => r.messageId === x!.id && r.reporterId === p.id)) s.reports.push({ id: rid(), messageId: x!.id, reporterId: p.id, reason: String(b.reason ?? ''), status: 'open', createdAt: now() });
    pub('admin', 'reports_changed'); return { ok: true };
  }

  // ── 관리자: 점수 ──
  if (M('GET', /^\/admin\/scores\/categories$/)) { admin(s); return { categories: CATS.map((c) => ({ ...c, subtypes: c.kind === 'event' ? SUBS : [] })) }; }
  if (M('GET', /^\/admin\/scores\/board$/)) { admin(s); return { teams: board(s), generatedAt: now() }; }
  if (M('GET', /^\/admin\/scores\/log$/)) {
    admin(s);
    const actors = new Map<string, string>();
    s.awards.forEach((a) => actors.set(a.actorId, a.actorName)); s.reversals.forEach((r) => actors.set(r.actorId, r.actorName));
    return { entries: log(s, q), actors: [...actors].map(([id, name]) => ({ id, name })) };
  }
  if (M('POST', /^\/admin\/scores\/awards$/)) {
    const p = admin(s);
    const prior = s.awards.find((a) => a.key === b.idempotencyKey);
    if (prior) return { award: prior, replay: true, teams: board(s) };
    if (!Number.isInteger(b.teamNumber) || b.teamNumber < 1 || b.teamNumber > 8) fail(400, 'invalid_team', '1~8조 중에서 선택해 주세요.');
    if (typeof b.points !== 'number' || !Number.isInteger(b.points) || b.points < 10 || b.points > 200 || b.points % 10) fail(400, 'invalid_points', '점수는 10점부터 200점까지 10점 단위로만 부여할 수 있습니다.');
    const cat = CATS.find((c) => c.key === b.categoryKey); if (!cat) fail(400, 'invalid_category', '종목을 선택해 주세요.');
    if (cat!.kind === 'event' && !SUBS.some((x) => x.key === b.subtypeKey)) fail(400, 'invalid_subtype', '이벤트 세부 유형을 선택해 주세요.');
    const reason = str(b.reason, 200, cat!.kind === 'main' ? 1 : 2);
    const sub = cat!.kind === 'event' ? b.subtypeKey : null;
    if (b.confirmDuplicate !== true && s.awards.some((a) => a.actorId === p.id && a.teamNumber === b.teamNumber && a.categoryKey === b.categoryKey && a.subtypeKey === sub && a.points === b.points && a.reason === reason && Date.now() - Date.parse(a.createdAt) < 60_000)) {
      fail(409, 'duplicate_warning', `방금 같은 내용(${b.teamNumber}조 · +${b.points}점 · ${reason})을 부여했습니다. 정말 한 번 더 부여할까요?`);
    }
    const a = { id: rid(), teamNumber: b.teamNumber, categoryKey: b.categoryKey, subtypeKey: sub, points: b.points, reason, actorId: p.id, actorName: p.name, key: b.idempotencyKey, createdAt: now() };
    s.awards.push(a); pub('admin', 'scores_changed');
    return { award: a, replay: false, teams: board(s) };
  }
  if ((m = M('POST', /^\/admin\/scores\/awards\/([^/]+)\/cancel$/))) {
    const p = admin(s);
    const reason = str(b.reason, 200, 2);
    if (b.password !== CANCEL_PASSWORD) { audit(s, p, 'cancel_bad_password'); fail(403, 'bad_password', '취소 비밀번호가 맞지 않습니다. 점수는 차감되지 않았습니다.'); }
    const a = s.awards.find((x) => x.id === m![1]); if (!a) fail(404, 'not_found', '점수 기록을 찾을 수 없습니다.');
    const ex = s.reversals.find((r) => r.awardId === a!.id);
    if (ex) { if (ex.key === b.idempotencyKey) return { reversal: { ...ex, awardId: a!.id }, replay: true, teams: board(s) }; fail(409, 'already_cancelled', `이미 ${ex.actorName}님이 취소한 기록입니다. 다시 차감되지 않습니다.`); }
    const r = { id: rid(), awardId: a!.id, points: -a!.points, reason, actorId: p.id, actorName: p.name, key: b.idempotencyKey, createdAt: now() };
    s.reversals.push(r); pub('admin', 'scores_changed');
    return { reversal: r, replay: false, teams: board(s) };
  }

  // ── 관리자: 체크인·공지·일정·경기·안내 ──
  if (M('GET', /^\/admin\/checkins(\/summary)?$/)) {
    const p = admin(s);
    const people = s.participants.map((x) => { const c = s.checkins.find((y) => y.participantId === x.id); return { id: x.id, name: x.name, employeeId: p.role === 'owner' ? x.employeeId : mask(x.employeeId), teamNumber: x.teamNumber, role: x.role, active: x.active, ticketNumber: c?.ticket ?? null, checkedInAt: c?.at ?? null }; });
    const act = people.filter((x) => x.active);
    return { teams: Array.from({ length: 8 }, (_, i) => ({ teamNumber: i + 1, total: act.filter((x) => x.teamNumber === i + 1).length, checkedIn: act.filter((x) => x.teamNumber === i + 1 && x.checkedInAt).length })), total: act.length, checkedIn: act.filter((x) => x.checkedInAt).length, people };
  }
  if ((m = M('GET', /^\/admin\/tickets\/([^/]+)$/))) {
    const a = admin(s); const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 1) fail(400, 'invalid_ticket', '행운권 번호를 숫자로 입력해 주세요.');
    const c = s.checkins.find((x) => x.ticket === n); const p = c && s.participants.find((x) => x.id === c.participantId);
    return { issued: s.checkins.length, ticket: p ? { ticketNumber: n, name: p.name, teamNumber: p.teamNumber, role: p.role, active: p.active, checkedInAt: c!.at, employeeId: a.role === 'owner' ? p.employeeId : mask(p.employeeId) } : null };
  }
  if (M('POST', /^\/admin\/participants$/)) {
    const a = admin(s);
    const name = String(b.name ?? '').trim(); const emp = String(b.employeeId ?? '').trim();
    if (!name || !emp) fail(400, 'invalid', '이름과 사번을 확인해 주세요.');
    if (!Number.isInteger(b.teamNumber) || b.teamNumber < 0 || b.teamNumber > 8) fail(400, 'invalid_team', '조를 선택해 주세요.');
    if (s.participants.some((x) => x.employeeId.toLowerCase() === emp.toLowerCase())) fail(409, 'exists', '이미 명단에 있는 사번입니다.');
    if (b.role === 'admin' && a.role !== 'owner') fail(403, 'forbidden', '관리자 추가는 owner만 할 수 있습니다.');
    const p = { id: rid(), employeeId: emp, name, teamNumber: b.teamNumber, role: b.role === 'admin' ? 'admin' as const : 'participant' as const, active: true };
    s.participants.push(p); audit(s, a, 'participant_add', p.id, { name, teamNumber: b.teamNumber });
    return { uid: p.id };
  }
  if (M('POST', /^\/owner\/tickets\/reset$/)) {
    const o = owner(s);
    if (b.confirm !== '초기화') fail(400, 'confirm', "확인 문구 '초기화'를 정확히 입력해 주세요.");
    if (b.password !== CANCEL_PASSWORD) fail(403, 'bad_password', '비밀번호가 맞지 않습니다. 아무것도 지워지지 않았습니다.');
    const removed = s.checkins.length;
    s.checkins = []; s.nextSeq = 1;
    const a2 = Array.from({ length: 300 }, (_, i) => i + 1);
    for (let i = 299; i > 0; i--) { const r = new Uint32Array(1); crypto.getRandomValues(r); const j = r[0] % (i + 1); [a2[i], a2[j]] = [a2[j], a2[i]]; }
    s.pool = a2; audit(s, o, 'tickets_reset', null, { removed });
    return { removed };
  }
  if (M('GET', /^\/admin\/announcements$/)) { const p = admin(s); return { announcements: anns(s, p.id, true) }; }
  if (M('POST', /^\/admin\/announcements$/)) {
    admin(s); const t = now();
    s.announcements.push({ id: rid(), title: str(b.title, 80, 1), body: str(b.body, 1000), important: !!b.important, published: b.published !== false, createdAt: t, updatedAt: t, reads: [] });
    pub('public', 'public_changed', { what: 'announcements' }); return { ok: true };
  }
  if ((m = M('PATCH', /^\/admin\/announcements\/([^/]+)$/))) {
    admin(s); const a = s.announcements.find((x) => x.id === m![1]); if (!a) fail(404, 'not_found', '공지를 찾을 수 없습니다.');
    Object.assign(a!, { title: str(b.title, 80, 1), body: str(b.body, 1000), important: !!b.important, published: b.published !== false, updatedAt: now() });
    pub('public', 'public_changed', { what: 'announcements' }); return { ok: true };
  }
  if (M('GET', /^\/admin\/schedule$/)) { admin(s); return { items: sched(s, true) }; }
  if ((m = M('PATCH', /^\/admin\/schedule\/([^/]+)$/))) {
    admin(s); const i = s.schedule.find((x) => x.id === m![1]); if (!i) fail(404, 'not_found', '일정을 찾을 수 없습니다.');
    Object.assign(i!, { title: str(b.title, 60, 1), note: str(b.note, 200), startTime: b.startTime || null, endTime: b.endTime || null, status: b.status, delayNote: str(b.delayNote, 120), public: b.public !== false, updatedAt: now() });
    pub('public', 'public_changed', { what: 'schedule' }); return { ok: true };
  }
  if (M('POST', /^\/admin\/schedule$/)) {
    admin(s);
    s.schedule.push({ id: rid(), sortOrder: Math.max(...s.schedule.map((x) => x.sortOrder)) + 10, startTime: b.startTime || null, endTime: b.endTime || null, title: str(b.title, 60, 1), note: str(b.note, 200), kind: 'general', gameKey: null, status: b.startTime ? 'scheduled' : 'time_tbd', delayNote: '', public: b.public !== false, updatedAt: now() });
    pub('public', 'public_changed', { what: 'schedule' }); return { ok: true };
  }
  if (M('GET', /^\/admin\/games$/)) { admin(s); return { games: s.games }; }
  if ((m = M('PATCH', /^\/admin\/games\/([^/]+)$/))) {
    admin(s); const g = s.games.find((x) => x.key === m![1]); if (!g) fail(404, 'not_found', '경기를 찾을 수 없습니다.');
    Object.assign(g!, { players: str(b.players, 100), summary: str(b.summary, 300), howTo: str(b.howTo, 1000), bracketNote: str(b.bracketNote, 200), pendingNote: str(b.pendingNote, 200), published: b.published !== false, updatedAt: now() });
    pub('public', 'public_changed', { what: 'games' }); return { ok: true };
  }
  if (M('GET', /^\/admin\/event$/)) { admin(s); return { ...s.event }; }
  if (M('PATCH', /^\/admin\/event$/)) {
    admin(s); const e = s.event;
    for (const k of ['schedulePublished', 'parkingPublished', 'returnBusPublished'] as const) if (typeof b[k] === 'boolean') e[k] = b[k];
    for (const k of ['parkingNote', 'returnBusNote', 'departureNote'] as const) if (b[k] !== undefined) e[k] = str(b[k], 300);
    if (b.statusNote !== undefined && b.statusNote !== e.statusNote) { e.statusNote = str(b.statusNote, 140); e.statusNoteUpdatedAt = now(); }
    e.updatedAt = now(); pub('public', 'public_changed', { what: 'event' }); return { ok: true };
  }
  if (M('GET', /^\/admin\/help$/)) {
    admin(s);
    return { requests: s.help.slice().sort((a, c) => Number(a.status === 'done') - Number(c.status === 'done') || c.createdAt.localeCompare(a.createdAt)).map((h) => { const p = s.participants.find((x) => x.id === h.requesterId)!; return { ...h, name: p.name, teamNumber: p.teamNumber }; }) };
  }
  if ((m = M('PATCH', /^\/admin\/help\/([^/]+)$/))) { admin(s); const h = s.help.find((x) => x.id === m![1]); if (h) { h.status = b.status; h.updatedAt = now(); } pub('admin', 'help_changed'); return { ok: true }; }
  if (M('GET', /^\/admin\/reports$/)) {
    admin(s);
    return { reports: s.reports.map((r) => { const x = s.messages.find((y) => y.id === r.messageId)!; return { id: r.id, reason: r.reason, status: r.status, createdAt: r.createdAt, messageId: x.id, channel: x.channel, body: x.body, senderName: x.senderName, senderTeam: x.senderTeam, hidden: !!x.hiddenAt, deleted: !!x.deletedAt, reporterName: s.participants.find((p) => p.id === r.reporterId)?.name ?? '' }; }) };
  }
  if ((m = M('PATCH', /^\/admin\/reports\/([^/]+)$/))) { admin(s); const r = s.reports.find((x) => x.id === m![1]); if (r) r.status = b.status; pub('admin', 'reports_changed'); return { ok: true }; }
  if ((m = M('POST', /^\/admin\/chat\/messages\/([^/]+)\/hide$/))) {
    const p = admin(s); const x = s.messages.find((y) => y.id === m![1]); if (!x) fail(404, 'not_found', '메시지를 찾을 수 없습니다.');
    x!.hiddenAt = b.hidden === false ? null : now(); audit(s, p, b.hidden === false ? 'chat_unhide' : 'chat_hide', x!.id);
    pub(wsCh(x!.channel), 'chat_update', pubMsg(x!)); return { message: pubMsg(x!) };
  }
  if (M('GET', /^\/admin\/setup-checklist$/)) {
    admin(s);
    const tbd = s.schedule.filter((i) => i.public && i.status === 'time_tbd').length;
    return { items: [
      { key: 'roster', label: '실제 참가자 명단 업로드', done: false, detail: '데모는 가상 TEST 명단 10명' },
      { key: 'cancel_password', label: '점수 취소 비밀번호 운영값 설정', done: false, detail: '데모는 1234 고정' },
      { key: 'schedule', label: '최종 일정 확정 공개', done: s.event.schedulePublished, detail: s.event.schedulePublished ? '공개됨' : '참가자에게 ‘초안’으로 표시 중' },
      { key: 'parking', label: '주차 안내 확인 후 공개', done: s.event.parkingPublished, detail: s.event.parkingPublished ? '공개됨' : '미공개' },
      { key: 'return_bus', label: '귀가 버스 배차 안내 입력', done: s.event.returnBusPublished && !!s.event.returnBusNote, detail: s.event.returnBusNote ? '입력됨' : '미입력' },
      { key: 'rules', label: '경기별 동률·교체·실패 기준, 제기차기 배점 해석 확정', done: false, detail: '현장 심판 브리핑에서 확정 (앱 자동채점 없음)' },
    ] };
  }

  // ── owner ──
  if (M('POST', /^\/owner\/roster\/(preview|commit)$/)) {
    owner(s);
    return fail(400, 'demo', '데모에서는 명단 업로드를 지원하지 않습니다. 실제 앱에서는 CSV 미리보기 → 오류 검증 → 반영 순서로 진행합니다.');
  }
  if ((m = M('POST', /^\/owner\/participants\/([^/]+)\/role$/))) {
    const o = owner(s); const p = s.participants.find((x) => x.id === m![1]); if (!p) fail(404, 'not_found', '참가자를 찾을 수 없습니다.');
    if (p!.id === o.id) fail(400, 'self_role', '본인의 역할은 바꿀 수 없습니다. 다른 owner에게 요청해 주세요.');
    if (p!.role === 'owner' && b.role !== 'owner' && s.participants.filter((x) => x.role === 'owner' && x.active).length <= 1) fail(400, 'last_owner', '마지막 owner는 해제할 수 없습니다.');
    audit(s, o, 'role_change', p!.id, { name: p!.name, from: p!.role, to: b.role }); p!.role = b.role;
    pub('me', 'revalidate', undefined, p!.id); return { ok: true };
  }
  if ((m = M('POST', /^\/owner\/participants\/([^/]+)\/team$/))) {
    const o = owner(s); const p = s.participants.find((x) => x.id === m![1]); if (!p) fail(404, 'not_found', '참가자를 찾을 수 없습니다.');
    const reason = str(b.reason, 200, 2);
    audit(s, o, 'team_change', p!.id, { name: p!.name, from: p!.teamNumber, to: b.teamNumber, reason }); p!.teamNumber = b.teamNumber;
    pub('me', 'revalidate', undefined, p!.id); return { ok: true };
  }
  if (M('GET', /^\/owner\/audit$/)) { owner(s); return { events: s.audit.slice(0, 300) }; }

  return fail(404, 'not_found', '데모에서 지원하지 않는 기능입니다.');
}

/** 데모: /api/...csv 다운로드 링크를 브라우저에서 직접 만든다 */
export function demoCsv(href: string): { name: string; csv: string } | null {
  const s = load();
  const cell = (v: unknown) => { let x = v == null ? '' : String(v); if (/^[=+\-@]/.test(x)) x = "'" + x; return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  const csv = (h: string[], rows: unknown[][]) => '﻿' + [h, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const p = s.participants.find((x) => x.id === session.get());
  if (!p || p.role === 'participant') return null;
  if (href.includes('/admin/scores/export.csv')) {
    return { name: 'score-log.csv', csv: csv(['기록ID', '부여일시', '조', '종목', '세부유형', '점수', '사유', '부여자', '상태', '취소자', '취소사유'],
      log(s, new URLSearchParams()).map((e) => [e.id, e.createdAt, `${e.teamNumber}조`, e.categoryLabel, e.subtypeLabel ?? '', e.points, e.reason, e.actorName, e.status === 'cancelled' ? '취소' : '유효', e.reversal?.actorName ?? '', e.reversal?.reason ?? ''])) };
  }
  if (p.role !== 'owner') return null;
  if (href.includes('/owner/export/checkins.csv')) {
    return { name: 'checkins.csv', csv: csv(['사번', '이름', '조', '역할', '체크인순번', '행운권'], s.participants.map((x) => { const c = s.checkins.find((y) => y.participantId === x.id); return [x.employeeId, x.name, x.teamNumber, x.role, c?.seq ?? '', c ? String(c.ticket).padStart(3, '0') : '']; })) };
  }
  if (href.includes('/owner/export/audit.csv')) return { name: 'audit.csv', csv: csv(['시각', '수행자', '동작', '상세'], s.audit.map((a) => [a.createdAt, a.actorName ?? '', a.action, JSON.stringify(a.detail)])) };
  return null;
}
