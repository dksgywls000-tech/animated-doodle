/**
 * 가을운동회 앱 — Firebase Cloud Functions (서울 리전)
 *
 * 브라우저(Netlify의 HTML)가 직접 하면 안 되는 일만 여기서 한다.
 *  - 이름+사번 확인 후 로그인 토큰 발급 + 행운권 배정(트랜잭션)
 *  - 점수 부여·취소(비밀번호 확인, 중복 방지)
 *  - 명단 업로드, 관리자 지정, 조 예외 변경, 타 조 채팅 열람(감사)
 *  - 최초 1회 설정(owner 등록)
 * 나머지 읽기·쓰기는 firestore.rules가 권한을 검사한다.
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { defineString } from 'firebase-functions/params';
import { createHash, randomUUID } from 'node:crypto';
import {
  LOGIN_FAILED_MESSAGE, hashPassword, hmac, normalizeEmployeeId, normalizeName, parseRoster, secureShuffle, verifyPassword, type Role,
} from './shared';
import { CATEGORIES, EVENT_SUBTYPES, SCHEDULE, RETURN_BUS_NOTE } from './seedData';
import { Allocator } from './alloc';

initializeApp();
const db = getFirestore();
setGlobalOptions({ region: 'asia-northeast3', maxInstances: 20 });

const SETUP_KEY = defineString('SETUP_KEY', { description: '최초 owner 등록용 일회용 설정 키(아무도 모르는 긴 문자열)' });
const CANCEL_PASSWORD_HASH = defineString('CANCEL_PASSWORD_HASH', { default: '', description: '점수 취소 비밀번호 해시. 비우면 1234' });
const RATE_LIMIT_SECRET = defineString('RATE_LIMIT_SECRET', { description: '로그인 시도 제한용 비밀값(16자 이상)' });

const POOL_SIZE = 300;
const DEFAULT_CANCEL_HASH = hashPassword('1234');
const cancelHash = () => CANCEL_PASSWORD_HASH.value() || DEFAULT_CANCEL_HASH;

const fail = (code: 'invalid-argument' | 'permission-denied' | 'unauthenticated' | 'not-found' | 'already-exists' | 'resource-exhausted' | 'failed-precondition' | 'aborted',
  message: string, details?: Record<string, unknown>): never => { throw new HttpsError(code, message, details); };

/** 사번은 그대로(대소문자 구분) 문서 ID로 쓰기 위해 안전하게 변환 */
const idKey = (employeeId: string) => createHash('sha256').update(employeeId).digest('hex');

const ref = {
  event: () => db.doc('config/event'),
  alloc: () => db.doc('private/allocation'),
  participant: (uid: string) => db.doc(`participants/${uid}`),
  employeeId: (uid: string) => db.doc(`employeeIds/${uid}`),
  loginIndex: (employeeId: string) => db.doc(`loginIndex/${idKey(employeeId)}`),
  checkin: (uid: string) => db.doc(`checkins/${uid}`),
  ticket: (n: number) => db.doc(`tickets/${n}`),
};

interface Participant { name: string; teamNumber: number; role: Role; active: boolean }

async function requireStaff(req: CallableRequest, ownerOnly = false): Promise<Participant & { uid: string }> {
  if (!req.auth) fail('unauthenticated', '로그인이 필요합니다. 이름과 사번으로 다시 입장해 주세요.');
  const snap = await ref.participant(req.auth!.uid).get();
  const p = snap.data() as Participant | undefined;
  if (!p || !p.active) fail('unauthenticated', '로그인이 필요합니다. 이름과 사번으로 다시 입장해 주세요.');
  if (ownerOnly ? p!.role !== 'owner' : p!.role === 'participant') fail('permission-denied', ownerOnly ? 'owner만 사용할 수 있습니다.' : '관리자만 사용할 수 있습니다.');
  return { uid: req.auth!.uid, ...p! };
}

async function audit(actor: { uid: string; name: string } | null, action: string, target: string | null = null, detail: Record<string, unknown> = {}) {
  await db.collection('audit').add({ actorId: actor?.uid ?? null, actorName: actor?.name ?? 'SYSTEM', action, target, detail, createdAt: FieldValue.serverTimestamp() });
}

/** 시간창 안 시도 횟수 제한 (문서 하나에 최근 시각 목록) */
async function hitLimit(path: string, windowMs: number): Promise<number> {
  const snap = await db.doc(path).get();
  const now = Date.now();
  return ((snap.get('times') as number[] | undefined) ?? []).filter((t) => now - t < windowMs).length;
}
async function recordHit(path: string, windowMs: number) {
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const s = await tx.get(db.doc(path));
    const times = ((s.get('times') as number[] | undefined) ?? []).filter((t) => now - t < windowMs);
    tx.set(db.doc(path), { times: [...times, now].slice(-200) });
  });
}

// ─────────────────────────────────────────────────────────────
// 로그인 + 행운권
// ─────────────────────────────────────────────────────────────

const allocator = new Allocator(db);
export async function allocateTicket(uid: string) {
  try {
    return await allocator.allocate(uid);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'not-initialized') fail('failed-precondition', '행사 설정이 아직 끝나지 않았습니다. 운영진에게 문의해 주세요.');
    if (code === 'busy') fail('aborted', '접속이 몰려 잠시 처리하지 못했습니다. 다시 입장해 주세요. (번호는 중복 배정되지 않습니다)');
    throw e;
  }
}

// 로그인은 인스턴스 1개(동시 처리 80)로 고정 → 행운권 배정이 전역으로 한 줄 처리된다
export const login = onCall({ maxInstances: 1, concurrency: 80, timeoutSeconds: 120, memory: '512MiB' }, async (req) => {
  const name = normalizeName(req.data?.name);
  const employeeId = normalizeEmployeeId(req.data?.employeeId);
  if (!name || !employeeId || name.length > 64 || employeeId.length > 64) fail('invalid-argument', LOGIN_FAILED_MESSAGE);
  const secret = RATE_LIMIT_SECRET.value();
  const ip = req.rawRequest.ip ?? 'unknown';
  const pairKey = `limits/login_${hmac(secret, `pair:${ip}:${employeeId.toLowerCase()}`)}`;
  const acctKey = `limits/login_${hmac(secret, `acct:${employeeId.toLowerCase()}`)}`;
  const [pair, acct] = await Promise.all([hitLimit(pairKey, 10 * 60_000), hitLimit(acctKey, 15 * 60_000)]);
  if (pair >= 5 || acct >= 15) fail('resource-exhausted', `입력 시도가 많아 잠시 제한되었습니다. 약 ${acct >= 15 ? 15 : 10}분 후 다시 시도하거나 운영진에게 문의해 주세요.`);

  const idx = await ref.loginIndex(employeeId).get();
  const uid = idx.get('uid') as string | undefined;
  const p = uid ? (await ref.participant(uid).get()).data() as Participant | undefined : undefined;
  if (!uid || !p || p.name !== name || !p.active) {
    await Promise.all([recordHit(pairKey, 10 * 60_000), recordHit(acctKey, 15 * 60_000)]);
    fail('unauthenticated', LOGIN_FAILED_MESSAGE);
  }
  const t = await allocateTicket(uid!);
  const token = await getAuth().createCustomToken(uid!);
  return { token, isNewCheckin: t.isNew };
});

// ─────────────────────────────────────────────────────────────
// 점수
// ─────────────────────────────────────────────────────────────
const CATS = CATEGORIES.map(([key, label, kind]) => ({ key, label, kind }));
const SUBS = EVENT_SUBTYPES.map(([key, label]) => ({ key, label }));
const KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;

export const awardScore = onCall(async (req) => {
  const actor = await requireStaff(req);
  const d = req.data ?? {};
  if (!Number.isInteger(d.teamNumber) || d.teamNumber < 1 || d.teamNumber > 8) fail('invalid-argument', '1~8조 중에서 선택해 주세요.');
  if (typeof d.points !== 'number' || !Number.isInteger(d.points) || d.points < 10 || d.points > 200 || d.points % 10 !== 0) fail('invalid-argument', '점수는 10점부터 200점까지 10점 단위로만 부여할 수 있습니다.');
  if (typeof d.idempotencyKey !== 'string' || !KEY_RE.test(d.idempotencyKey)) fail('invalid-argument', '요청 식별값이 올바르지 않습니다. 화면을 새로고침해 주세요.');
  const cat = CATS.find((c) => c.key === d.categoryKey);
  if (!cat) fail('invalid-argument', '종목을 선택해 주세요.');
  let subtypeKey: string | null = null;
  if (cat!.kind === 'event') {
    if (!SUBS.some((s) => s.key === d.subtypeKey)) fail('invalid-argument', '이벤트 세부 유형을 선택해 주세요.');
    subtypeKey = d.subtypeKey;
  } else if (d.subtypeKey != null) fail('invalid-argument', '이 종목에는 세부 유형이 없습니다.');
  const reason = typeof d.reason === 'string' ? d.reason.normalize('NFC').trim() : '';
  const min = cat!.kind === 'main' ? 1 : 2;
  if (reason.length < min || reason.length > 200) fail('invalid-argument', min > 1 ? '구체적인 사유를 입력해 주세요. (2~200자)' : '사유를 입력해 주세요.');

  const awardRef = db.doc(`awards/${d.idempotencyKey}`);
  const record = { teamNumber: d.teamNumber, categoryKey: cat!.key, subtypeKey, points: d.points, reason, actorId: actor.uid, actorName: actor.name };

  if (d.confirmDuplicate !== true) {
    const recent = await db.collection('awards').where('actorId', '==', actor.uid).get();
    const cutoff = Date.now() - 60_000;
    const dup = recent.docs.find((x) => x.id !== d.idempotencyKey && (x.get('createdAt') as Timestamp | undefined)?.toMillis()! > cutoff
      && x.get('teamNumber') === record.teamNumber && x.get('categoryKey') === record.categoryKey && x.get('subtypeKey') === record.subtypeKey
      && x.get('points') === record.points && x.get('reason') === record.reason);
    if (dup) fail('already-exists', `방금 같은 내용(${record.teamNumber}조 · +${record.points}점 · ${reason})을 부여했습니다. 정말 한 번 더 부여할까요?`, { code: 'duplicate_warning' });
  }

  const replay = await db.runTransaction(async (tx) => {
    const prior = await tx.get(awardRef);
    if (prior.exists) {
      const same = (Object.keys(record) as (keyof typeof record)[]).every((k) => prior.get(k) === record[k]);
      if (!same) fail('already-exists', '이미 처리된 다른 요청과 식별값이 겹칩니다. 화면을 새로고침한 뒤 다시 시도해 주세요.', { code: 'idempotency_conflict' });
      return true;
    }
    tx.create(awardRef, { ...record, createdAt: FieldValue.serverTimestamp() });
    return false;
  });
  return { id: awardRef.id, replay };
});

export const cancelScore = onCall(async (req) => {
  const actor = await requireStaff(req);
  const d = req.data ?? {};
  if (typeof d.awardId !== 'string' || !KEY_RE.test(d.awardId)) fail('not-found', '점수 기록을 찾을 수 없습니다.');
  if (typeof d.idempotencyKey !== 'string' || !KEY_RE.test(d.idempotencyKey)) fail('invalid-argument', '요청 식별값이 올바르지 않습니다.');
  const reason = typeof d.reason === 'string' ? d.reason.trim() : '';
  if (reason.length < 2 || reason.length > 200) fail('invalid-argument', '취소 사유를 입력해 주세요. (2~200자)');
  const failKey = `limits/cancel_${actor.uid}`;
  if (await hitLimit(failKey, 10 * 60_000) >= 5) fail('resource-exhausted', '비밀번호 오류가 많아 10분 동안 취소가 제한됩니다. 점수는 차감되지 않았습니다.');
  const pw = typeof d.password === 'string' ? d.password : '';
  if (!pw || pw.length > 100 || !verifyPassword(pw, cancelHash())) {
    await recordHit(failKey, 10 * 60_000);
    fail('permission-denied', '취소 비밀번호가 맞지 않습니다. 점수는 차감되지 않았습니다.', { code: 'bad_password' });
  }
  const awardRef = db.doc(`awards/${d.awardId}`);
  const revRef = db.doc(`reversals/${d.awardId}`); // 원기록당 문서 하나 → 중복 취소 불가
  return db.runTransaction(async (tx) => {
    const [award, rev] = await Promise.all([tx.get(awardRef), tx.get(revRef)]);
    if (!award.exists) fail('not-found', '점수 기록을 찾을 수 없습니다.');
    if (rev.exists) {
      if (rev.get('idempotencyKey') === d.idempotencyKey && rev.get('actorId') === actor.uid) return { replay: true };
      fail('already-exists', `이미 ${rev.get('actorName')}님이 취소한 기록입니다. 다시 차감되지 않습니다.`, { code: 'already_cancelled' });
    }
    tx.create(revRef, { awardId: d.awardId, points: -(award.get('points') as number), reason, actorId: actor.uid, actorName: actor.name, idempotencyKey: d.idempotencyKey, createdAt: FieldValue.serverTimestamp() });
    return { replay: false };
  });
});

// ─────────────────────────────────────────────────────────────
// 명단·권한 (owner)
// ─────────────────────────────────────────────────────────────

/**
 * 명단 병합 정책: 사번 기준. 새 사번 추가, 기존 사번은 이름·활성·역할 갱신, 파일에 없는 사람은 유지.
 * 오류가 하나라도 있으면 전체 중단. 역할 변경은 confirmRoleChanges 필요.
 * 체크인한 사람의 조 변경은 업로드로 불가. 본인 강등·비활성화·마지막 owner 제거 불가.
 */
export const importRoster = onCall({ timeoutSeconds: 120 }, async (req) => {
  const actor = await requireStaff(req, true);
  const text = req.data?.csv;
  if (typeof text !== 'string' || !text.trim() || text.length > 512 * 1024) fail('invalid-argument', 'CSV 파일 내용을 확인해 주세요.');
  const { rows, errors } = parseRoster(text);
  const [ps, ids, cis] = await Promise.all([db.collection('participants').get(), db.collection('employeeIds').get(), db.collection('checkins').get()]);
  const empOf = new Map(ids.docs.map((x) => [x.id, x.get('employeeId') as string]));
  const checked = new Set(cis.docs.map((x) => x.id));
  const byEmp = new Map(ps.docs.map((x) => [empOf.get(x.id) ?? '', { uid: x.id, ...(x.data() as Participant) }]));
  const byEmpLower = new Map([...byEmp].map(([k, v]) => [k.toLowerCase(), v]));
  const inserts: typeof rows = [];
  const updates: { row: (typeof rows)[number]; uid: string; changes: string[] }[] = [];
  const roleChanges: { line: number; name: string; from: Role; to: Role }[] = [];
  let unchanged = 0;
  for (const row of rows) {
    const cur = byEmp.get(row.employeeId);
    if (!cur) {
      if (byEmpLower.has(row.employeeId.toLowerCase())) { errors.push({ line: row.line, reason: '기존 사번과 대소문자만 다릅니다' }); continue; }
      inserts.push(row); continue;
    }
    const changes: string[] = [];
    if (cur.name !== row.name) changes.push('이름');
    if (cur.active !== row.active) changes.push(row.active ? '활성화' : '비활성화');
    if (cur.teamNumber !== row.teamNumber) {
      if (checked.has(cur.uid)) { errors.push({ line: row.line, reason: `체크인한 참가자의 조 변경(${cur.teamNumber}→${row.teamNumber}조)은 업로드로 할 수 없습니다. '조 변경'을 사용하세요` }); continue; }
      changes.push(`조 ${cur.teamNumber}→${row.teamNumber}`);
    }
    if (cur.role !== row.role) {
      if (cur.uid === actor.uid) { errors.push({ line: row.line, reason: '본인의 역할은 업로드로 바꿀 수 없습니다' }); continue; }
      roleChanges.push({ line: row.line, name: row.name, from: cur.role, to: row.role });
      changes.push(`역할 ${cur.role}→${row.role}`);
    }
    if (cur.uid === actor.uid && !row.active) { errors.push({ line: row.line, reason: '본인을 비활성화할 수 없습니다' }); continue; }
    if (changes.length) updates.push({ row, uid: cur.uid, changes }); else unchanged++;
  }
  const owners = new Set(ps.docs.filter((x) => x.get('role') === 'owner' && x.get('active')).map((x) => x.id));
  for (const u of updates) { if (u.row.role === 'owner' && u.row.active) owners.add(u.uid); else owners.delete(u.uid); }
  if (!owners.size && !inserts.some((i) => i.role === 'owner' && i.active)) errors.push({ line: 0, reason: '활성 owner가 한 명 이상 남아야 합니다' });
  errors.sort((a, b) => a.line - b.line);
  const summary = {
    inserts: inserts.length, updates: updates.map((u) => ({ line: u.row.line, name: u.row.name, teamNumber: u.row.teamNumber, changes: u.changes })),
    roleChanges, unchanged, untouchedExisting: ps.size - updates.length - unchanged, errors,
    sample: inserts.slice(0, 5).map((r) => ({ line: r.line, name: r.name, teamNumber: r.teamNumber, role: r.role, active: r.active })),
  };
  if (req.data?.commit !== true) return summary;
  if (errors.length) fail('failed-precondition', '오류가 있는 행이 있어 전체 반영을 중단했습니다.', { code: 'roster_invalid', errors });
  if (roleChanges.length && req.data?.confirmRoleChanges !== true) fail('failed-precondition', '역할 변경이 포함되어 있습니다. 변경 내용을 확인한 뒤 다시 반영해 주세요.', { code: 'role_change_confirmation', roleChanges });

  // 검증을 모두 통과한 뒤 400개씩 나눠 쓴다
  const writes: ((b: FirebaseFirestore.WriteBatch) => void)[] = [];
  for (const r of inserts) {
    const uid = randomUUID();
    writes.push((b) => b.create(ref.participant(uid), { name: r.name, teamNumber: r.teamNumber, role: r.role, active: r.active, updatedAt: FieldValue.serverTimestamp() }));
    writes.push((b) => b.create(ref.employeeId(uid), { employeeId: r.employeeId }));
    writes.push((b) => b.create(ref.loginIndex(r.employeeId), { uid }));
  }
  for (const u of updates) writes.push((b) => b.update(ref.participant(u.uid), { name: u.row.name, teamNumber: u.row.teamNumber, role: u.row.role, active: u.row.active, updatedAt: FieldValue.serverTimestamp() }));
  for (let i = 0; i < writes.length; i += 400) {
    const b = db.batch();
    writes.slice(i, i + 400).forEach((w) => w(b));
    await b.commit();
  }
  for (const u of updates) if (!u.row.active) await getAuth().revokeRefreshTokens(u.uid).catch(() => {});
  await audit(actor, 'roster_import', null, { inserted: inserts.length, updated: updates.length, unchanged, roleChanges: roleChanges.map((r) => ({ line: r.line, from: r.from, to: r.to })) });
  return { inserted: inserts.length, updated: updates.length, unchanged };
});

export const setRole = onCall(async (req) => {
  const actor = await requireStaff(req, true);
  const { uid, role } = req.data ?? {};
  if (!['participant', 'admin', 'owner'].includes(role)) fail('invalid-argument', '역할 값이 올바르지 않습니다.');
  if (typeof uid !== 'string' || !uid) fail('not-found', '참가자를 찾을 수 없습니다.');
  if (uid === actor.uid) fail('invalid-argument', '본인의 역할은 바꿀 수 없습니다. 다른 owner에게 요청해 주세요.');
  const from = await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref.participant(uid));
    if (!cur.exists) fail('not-found', '참가자를 찾을 수 없습니다.');
    if (cur.get('role') === 'owner' && role !== 'owner') {
      const owners = await tx.get(db.collection('participants').where('role', '==', 'owner').where('active', '==', true));
      if (owners.size <= 1) fail('invalid-argument', '마지막 owner는 해제할 수 없습니다.');
    }
    tx.update(ref.participant(uid), { role, updatedAt: FieldValue.serverTimestamp() });
    return cur.get('role') as Role;
  });
  await audit(actor, 'role_change', uid, { from, to: role });
  return { from, to: role };
});

export const changeTeam = onCall(async (req) => {
  const actor = await requireStaff(req, true);
  const { uid, teamNumber } = req.data ?? {};
  const reason = typeof req.data?.reason === 'string' ? req.data.reason.trim() : '';
  if (!Number.isInteger(teamNumber) || teamNumber < 1 || teamNumber > 8) fail('invalid-argument', '1~8조 중에서 선택해 주세요.');
  if (reason.length < 2 || reason.length > 200) fail('invalid-argument', '조 변경 사유를 입력해 주세요.');
  const cur = await ref.participant(String(uid)).get();
  if (!cur.exists) fail('not-found', '참가자를 찾을 수 없습니다.');
  if (cur.get('teamNumber') === teamNumber) fail('invalid-argument', '이미 같은 조입니다.');
  await ref.participant(String(uid)).update({ teamNumber, updatedAt: FieldValue.serverTimestamp() });
  await audit(actor, 'team_change', String(uid), { name: cur.get('name'), from: cur.get('teamNumber'), to: teamNumber, reason });
  return { from: cur.get('teamNumber'), to: teamNumber };
});

/** 관리자가 다른 조 채팅을 확인 — 감사 기록이 남는 별도 경로 */
export const adminTeamChat = onCall(async (req) => {
  const actor = await requireStaff(req);
  const team = req.data?.team;
  if (!Number.isInteger(team) || team < 1 || team > 8) fail('invalid-argument', '1~8조 중에서 선택해 주세요.');
  await audit(actor, 'admin_view_team_chat', `team:${team}`);
  const snap = await db.collection('messages').where('channel', '==', `team:${team}`).orderBy('createdAt', 'desc').limit(100).get();
  return { messages: snap.docs.map((x) => ({ id: x.id, ...x.data(), createdAt: (x.get('createdAt') as Timestamp | null)?.toDate().toISOString() ?? null })) };
});

/** 사번이 포함된 명단 내보내기 (owner) */
export const exportRoster = onCall(async (req) => {
  const actor = await requireStaff(req, true);
  const [ps, ids, cis] = await Promise.all([db.collection('participants').get(), db.collection('employeeIds').get(), db.collection('checkins').get()]);
  const emp = new Map(ids.docs.map((x) => [x.id, x.get('employeeId')]));
  const ci = new Map(cis.docs.map((x) => [x.id, x.data()]));
  await audit(actor, 'export_checkins');
  return {
    rows: ps.docs.map((x) => {
      const c = ci.get(x.id);
      return { employeeId: emp.get(x.id) ?? '', name: x.get('name'), teamNumber: x.get('teamNumber'), role: x.get('role'), active: x.get('active'),
        seq: c?.seq ?? null, ticket: c?.ticket ?? null, at: (c?.at as Timestamp | undefined)?.toDate().toISOString() ?? null };
    }),
  };
});

/** 행운권 번호로 사번 확인 (owner) — 관리자는 이름·조만 Firestore에서 직접 읽는다 */
export const ticketOwnerEmployeeId = onCall(async (req) => {
  const actor = await requireStaff(req, true);
  const uid = String(req.data?.uid ?? '');
  const snap = await ref.employeeId(uid).get();
  await audit(actor, 'ticket_lookup_employee_id', uid);
  return { employeeId: snap.get('employeeId') ?? null };
});

// ─────────────────────────────────────────────────────────────
// 최초 1회 설정
// ─────────────────────────────────────────────────────────────

/**
 * 배포 직후 한 번만: 설정 키를 아는 사람이 행사 기본값(일정·행운권 풀)을 만들고 첫 owner를 등록한다.
 * owner가 한 명이라도 생기면 다시 실행되지 않는다.
 */
export const bootstrap = onCall(async (req) => {
  const key = typeof req.data?.setupKey === 'string' ? req.data.setupKey : '';
  const expected = SETUP_KEY.value();
  if (!expected || expected.length < 8 || key !== expected) fail('permission-denied', '설정 키가 맞지 않습니다.');
  const name = normalizeName(req.data?.name);
  const employeeId = normalizeEmployeeId(req.data?.employeeId);
  const teamNumber = req.data?.teamNumber;
  if (!name || !employeeId || employeeId.includes('/') || !Number.isInteger(teamNumber) || teamNumber < 1 || teamNumber > 8) fail('invalid-argument', '이름·사번·조(1~8)를 확인해 주세요.');
  const uid = randomUUID();
  await db.runTransaction(async (tx) => {
    const ev = await tx.get(ref.event());
    if (ev.get('bootstrapped')) fail('failed-precondition', '이미 설정이 끝났습니다. owner 계정으로 로그인해 주세요.');
    const idx = await tx.get(ref.loginIndex(employeeId));
    if (idx.exists) fail('already-exists', '이미 등록된 사번입니다.');
    tx.set(ref.event(), {
      title: '2026 하이테크본부 가을운동회', date: '2026-10-21', venue: '이충동 부락산 분수공원 야외공연장', bootstrapped: true,
      schedulePublished: false, parkingPublished: false,
      parkingNote: '자차 이용 시 이충문화체육센터 주차장. 원문 안내: 3시간 무료, 초과 요금은 개인 부담(지원 없음).',
      returnBusPublished: true, returnBusNote: RETURN_BUS_NOTE,
      departureNote: '기존 귀향/퇴근버스 탑승지에서 출발합니다. 버스 4대 2회 운행 예정이며 배차는 별도 안내됩니다.',
      statusNote: '', statusNoteUpdatedAt: null, updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(ref.alloc(), { pool: secureShuffle(POOL_SIZE) });
    SCHEDULE.forEach(([startTime, endTime, title, note, kind, , status], i) => {
      tx.set(db.collection('schedule').doc(), { sortOrder: (i + 1) * 10, startTime, endTime, title, note, kind, status, delayNote: '', public: true, updatedAt: FieldValue.serverTimestamp() });
    });
    tx.create(ref.participant(uid), { name, teamNumber, role: 'owner', active: true, updatedAt: FieldValue.serverTimestamp() });
    tx.create(ref.employeeId(uid), { employeeId });
    tx.create(ref.loginIndex(employeeId), { uid });
  });
  await audit({ uid, name }, 'event_initialized', null, { ticketPool: POOL_SIZE });
  return { ok: true };
});

