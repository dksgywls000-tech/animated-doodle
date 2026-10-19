// Firebase 버전 통합 테스트 — 실제 Firebase 에뮬레이터(Auth·Firestore·Functions)에서 실행
//   npm run test:firebase
// 에뮬레이터 안에서 다시 실행될 때는 FIREBASE_TEST_INNER=1
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (!process.env.FIREBASE_TEST_INNER) {
  writeFileSync(resolve(root, 'firebase/functions/.env.local'), 'SETUP_KEY=test-setup-key-123\nRATE_LIMIT_SECRET=test-rate-limit-secret-0123\nCANCEL_PASSWORD_HASH=\n');
  const b = spawnSync('npm', ['--prefix', 'firebase/functions', 'run', 'build'], { cwd: root, stdio: 'inherit' });
  if (b.status) process.exit(b.status);
  const r = spawnSync('npx', ['-y', 'firebase-tools@15.34.0', 'emulators:exec', '--project', 'demo-fieldday', '--only', 'auth,firestore,functions',
    `FIREBASE_TEST_INNER=1 node ${resolve(root, 'scripts/firebase-test.mjs')}`], { cwd: resolve(root, 'firebase'), stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const { initializeApp, deleteApp } = await import('firebase/app');
const { getAuth, connectAuthEmulator, signInWithCustomToken } = await import('firebase/auth');
const fs = await import('firebase/firestore');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = await import('firebase/functions');
const { createRequire } = await import('node:module');
const req = createRequire(resolve(root, 'firebase/functions/package.json'));
const admin = req('firebase-admin/app');
const { getFirestore: adminDb } = req('firebase-admin/firestore');
admin.initializeApp({ projectId: 'demo-fieldday' });
const A = adminDb();

let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log('  ✓', msg); } else { failed++; console.log('  ✗', msg); } };
const rejects = async (p, msg, code) => {
  try { await p; ok(false, msg + ' (거절되지 않음)'); } catch (e) { ok(!code || String(e.code).includes(code), `${msg} → ${e.code}`); }
};
let n = 0;
function client() {
  const app = initializeApp({ apiKey: 'fake', projectId: 'demo-fieldday', appId: 'x' }, 'c' + n++);
  const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = fs.getFirestore(app); fs.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const fns = getFunctions(app, 'asia-northeast3'); connectFunctionsEmulator(fns, '127.0.0.1', 5001);
  const call = (name, data) => httpsCallable(fns, name, { timeout: 120000 })(data).then((r) => r.data);
  return { app, auth, db, call };
}
async function loginAs(name, employeeId) {
  const c = client();
  const r = await c.call('login', { name, employeeId });
  await signInWithCustomToken(c.auth, r.token);
  c.uid = c.auth.currentUser.uid; c.isNew = r.isNewCheckin;
  return c;
}
const key = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
const { doc, getDoc, getDocs, collection, query, where, setDoc, writeBatch, serverTimestamp, updateDoc } = fs;

console.log('\n[1] 최초 설정');
const anon = client();
await rejects(anon.call('bootstrap', { setupKey: 'wrong', name: '총괄', employeeId: 'O-1', teamNumber: 1 }), '틀린 설정 키 거절', 'permission-denied');
await anon.call('bootstrap', { setupKey: 'test-setup-key-123', name: '총괄', employeeId: 'O-1', teamNumber: 1 });
ok((await A.doc('private/allocation').get()).get('pool').length === 300, '행운권 풀 300개 생성');
const sched = await A.collection('schedule').orderBy('sortOrder').get();
ok(sched.docs.some((d) => d.get('title') === '퇴근버스 탑승' && d.get('startTime') === '17:40'), '일정에 17:40 퇴근버스 탑승');
ok(!sched.docs.some((d) => /줄넘기|튜브|공 튕기기|풍선/.test(d.get('title'))), '경기별 세부 일정 없음');
await rejects(anon.call('bootstrap', { setupKey: 'test-setup-key-123', name: 'x', employeeId: 'O-2', teamNumber: 1 }), '두 번째 설정 거절', 'failed-precondition');

console.log('\n[2] 로그인·명단');
const owner = await loginAs('총괄', 'O-1');
const lines = ['employee_id,name,team_number,role,active', 'M-1,관리일,2,admin,true', 'M-2,관리이,4,admin,true', 'P-1,참가일,3,,', 'P-2,참가이,5,,', '000123,영시작,6,,', 'D-1,동명,7,,', 'D-2,동명,8,,', 'X-1,비활성,1,,false'];
for (let i = 1; i <= 350; i++) lines.push(`C-${String(i).padStart(4, '0')},참가자${i},${((i - 1) % 8) + 1},,`);
const csv = lines.join('\r\n');
const pre = await owner.call('importRoster', { csv, commit: false });
ok(pre.inserts === 358 && pre.errors.length === 0, `미리보기: 추가 ${pre.inserts}, 오류 ${pre.errors.length}`);
const bad = await owner.call('importRoster', { csv: 'employee_id,name,team_number\nZ-1,오류,9', commit: false });
ok(bad.errors.length === 1 && bad.errors[0].line === 2, '조 범위 오류 행 번호 표시');
await rejects(owner.call('importRoster', { csv: 'employee_id,name,team_number\nZ-1,오류,9', commit: true }), '오류 있으면 반영 중단', 'failed-precondition');
await owner.call('importRoster', { csv, commit: true });
ok((await A.collection('participants').count().get()).data().count === 359, '명단 359명 반영');

await rejects(anon.call('login', { name: '참가일', employeeId: 'P-2' }), '다른 행 이름+사번 혼합 거절', 'unauthenticated');
await rejects(anon.call('login', { name: '비활성', employeeId: 'X-1' }), '비활성 거절', 'unauthenticated');
await rejects(anon.call('login', { name: '영시작', employeeId: '123' }), '앞자리 0 빠진 사번 거절', 'unauthenticated');
const zero = await loginAs('영시작', '000123');
ok(!!zero.uid, '000123 로그인 성공');
const d1 = await loginAs('동명', 'D-1'); const d2 = await loginAs('동명', 'D-2');
ok(d1.uid !== d2.uid, '동명이인 각자 다른 계정');
for (let i = 0; i < 5; i++) await anon.call('login', { name: '참가이', employeeId: 'WRONG-1' }).catch(() => {});
await rejects(anon.call('login', { name: '참가이', employeeId: 'WRONG-1' }), '반복 실패 제한', 'resource-exhausted');

console.log('\n[3] 행운권 동시성');
const { Allocator } = req(resolve(root, 'firebase/functions/lib/alloc.js'));
const { createHash } = await import('node:crypto');
const uidOf = async (emp) => (await A.doc(`loginIndex/${createHash('sha256').update(emp).digest('hex')}`).get()).get('uid');
const cUids = await Promise.all(Array.from({ length: 350 }, (_, i) => uidOf(`C-${String(i + 1).padStart(4, '0')}`)));
const before = (await A.collection('checkins').count().get()).data().count;
// (a) 운영 환경과 같은 구조: 로그인 함수 인스턴스 1개가 300명 넘게 동시에 받음
const single = new Allocator(A);
let t0 = Date.now();
const ra = await Promise.allSettled(cUids.slice(0, 300).map((u) => single.allocate(u)));
ok(ra.every((r) => r.status === 'fulfilled'), `(a) 인스턴스 1개, 300명 동시 → 모두 성공 (${((Date.now() - t0) / 1000).toFixed(1)}초)`);
// (b) 비정상 상황 대비: 인스턴스 3개가 동시에 경쟁
const multi = [new Allocator(A), new Allocator(A), new Allocator(A)];
t0 = Date.now();
const rb = await Promise.allSettled(cUids.slice(300, 345).map((u, i) => multi[i % 3].allocate(u)));
ok(rb.every((r) => r.status === 'fulfilled'), `(b) 인스턴스 3개 경쟁, 45명 동시 → 모두 성공 (${((Date.now() - t0) / 1000).toFixed(1)}초)`);
// (c) 실제 로그인 함수(HTTP) 경로로 동시 5명 + 같은 사람 중복 요청
t0 = Date.now();
const rc = await Promise.allSettled([...Array.from({ length: 5 }, (_, i) => anon.call('login', { name: `참가자${346 + i}`, employeeId: `C-${String(346 + i).padStart(4, '0')}` })),
  anon.call('login', { name: '참가자346', employeeId: 'C-0346' })]);
ok(rc.every((r) => r.status === 'fulfilled'), `(c) 실제 로그인 함수 동시 호출 → 모두 성공 (${((Date.now() - t0) / 1000).toFixed(1)}초)`);
const cis = (await A.collection('checkins').get()).docs.map((d) => d.data());
const total = cis.length;
ok(total === before + 350, `체크인 ${total}건 (= 기존 ${before} + 350)`);
const seqs = cis.map((c) => c.seq).sort((x, y) => x - y);
ok(seqs.every((v, i) => v === i + 1), `순번 1~${total} 빈틈·중복 없음`);
ok(new Set(cis.map((c) => c.ticket)).size === total, '행운권 번호 중복 없음');
const first300 = cis.filter((c) => c.seq <= 300).map((c) => c.ticket).sort((x, y) => x - y);
ok(first300.length === 300 && first300.every((v, i) => v === i + 1), '1~300번째 입장자의 번호는 정확히 1~300');
ok(cis.filter((c) => c.seq > 300).every((c) => c.ticket === c.seq), '301번째부터는 순번 = 번호 (301, 302, …)');
ok(cis.filter((c) => c.seq <= 300 && c.ticket === c.seq).length < 20, '1~300 구간은 무작위로 섞여 있음');
ok((await A.collection('tickets').count().get()).data().count === total, 'tickets 문서 수 = 체크인 수');
const p1a = await loginAs('참가일', 'P-1');
const again = await Promise.all(Array.from({ length: 10 }, () => anon.call('login', { name: '참가일', employeeId: 'P-1' })));
ok(again.every((r) => r.isNewCheckin === false), '같은 사람 10번 동시 로그인 → 새 체크인 없음');
ok((await A.collection('checkins').count().get()).data().count === total + 1, '체크인 1건만 추가');
const myTicket = (await getDoc(doc(p1a.db, 'checkins', p1a.uid))).data().ticket;
ok(typeof myTicket === 'number', '본인 행운권 읽기 가능');

console.log('\n[4] 보안 규칙 — 참가자');
const p = p1a;
await rejects(getDocs(collection(p.db, 'awards')), '참가자 점수 읽기 차단', 'permission-denied');
await rejects(getDocs(collection(p.db, 'reversals')), '참가자 취소기록 읽기 차단', 'permission-denied');
await rejects(getDocs(collection(p.db, 'tickets')), '참가자 행운권 목록 읽기 차단', 'permission-denied');
await rejects(getDoc(doc(p.db, 'employeeIds', zero.uid)), '타인 사번 읽기 차단', 'permission-denied');
await rejects(getDocs(collection(p.db, 'participants')), '전체 명단 읽기 차단', 'permission-denied');
await rejects(getDoc(doc(p.db, 'checkins', zero.uid)), '타인 행운권 읽기 차단', 'permission-denied');
await rejects(getDoc(doc(p.db, 'private', 'allocation')), '행운권 풀 읽기 차단', 'permission-denied');
await rejects(setDoc(doc(p.db, 'awards', 'hack12345'), { teamNumber: 3, points: 200 }), '참가자 점수 직접 쓰기 차단', 'permission-denied');
await rejects(updateDoc(doc(p.db, 'participants', p.uid), { role: 'admin' }), '자기 역할 변경 차단', 'permission-denied');
await rejects(p.call('awardScore', { teamNumber: 3, categoryKey: 'cheer', points: 200, reason: '해킹 시도', idempotencyKey: key() }), '참가자 점수 부여 함수 차단', 'permission-denied');
await rejects(getDocs(query(collection(p.db, 'audit'))), '감사 기록 읽기 차단', 'permission-denied');

console.log('\n[5] 채팅 규칙');
const send = (c, ch, body, extra = {}) => {
  const b = writeBatch(c.db);
  b.set(doc(c.db, 'messages', `${c.uid}_${key()}`), { channel: ch, senderId: c.uid, senderName: extra.name ?? '참가일', senderTeam: extra.team ?? 3, staff: false, body, createdAt: serverTimestamp(), deletedAt: null, hiddenAt: null });
  b.set(doc(c.db, 'rate', c.uid), { lastAt: serverTimestamp() });
  return b.commit();
};
await send(p, 'team:3', '3조 화이팅');
ok(true, '자기 조 메시지 전송');
await rejects(send(p, 'all', '연속'), '1초 안 연속 전송 차단(도배)', 'permission-denied');
await new Promise((r) => setTimeout(r, 1100));
await rejects(send(p, 'team:5', '침입'), '다른 조 방에 쓰기 차단', 'permission-denied');
await new Promise((r) => setTimeout(r, 1100));
await rejects(send(p, 'all', '사칭', { name: '관리일' }), '이름 사칭 차단', 'permission-denied');
await rejects(getDocs(query(collection(p.db, 'messages'), where('channel', '==', 'team:5'))), '다른 조 방 읽기 차단', 'permission-denied');
await rejects(getDocs(collection(p.db, 'messages')), '채널 조건 없는 전체 조회 차단', 'permission-denied');
ok((await getDocs(query(collection(p.db, 'messages'), where('channel', '==', 'team:3')))).size >= 1, '자기 조 방 읽기 가능');

console.log('\n[6] 점수 부여·취소');
const adm = await loginAs('관리일', 'M-1');
const adm2 = await loginAs('관리이', 'M-2');
const totalOf = async (t) => {
  const aw = (await A.collection('awards').where('teamNumber', '==', t).get()).docs;
  let s = 0; for (const a of aw) { s += a.get('points'); const r = await A.doc(`reversals/${a.id}`).get(); if (r.exists) s += r.get('points'); } return s;
};
const a200 = await adm.call('awardScore', { teamNumber: 6, categoryKey: 'balloon', points: 200, reason: '풍선기둥 1위', idempotencyKey: key() });
const a50 = await adm.call('awardScore', { teamNumber: 6, categoryKey: 'cheer', points: 50, reason: '응원 열정', idempotencyKey: key() });
ok(await totalOf(6) === 250, '200 + 50 = 250');
for (const v of [15, 0, -10, 201, '100', 10.5]) await rejects(adm.call('awardScore', { teamNumber: 1, categoryKey: 'cheer', points: v, reason: '응원 테스트', idempotencyKey: key() }), `잘못된 점수 ${JSON.stringify(v)} 거절`, 'invalid-argument');
await rejects(adm.call('cancelScore', { awardId: a50.id, password: '0000', reason: '실수', idempotencyKey: key() }), '틀린 취소 비밀번호 거절', 'permission-denied');
ok(await totalOf(6) === 250, '비밀번호 틀리면 합계 그대로');
await rejects(p.call('cancelScore', { awardId: a50.id, password: '1234', reason: '해킹', idempotencyKey: key() }), '참가자는 1234를 알아도 취소 불가', 'permission-denied');
const cancels = await Promise.allSettled([adm, adm2, owner, adm, adm2].map((c) => c.call('cancelScore', { awardId: a50.id, password: '1234', reason: '중복 입력', idempotencyKey: key() })));
ok(cancels.filter((r) => r.status === 'fulfilled').length === 1, '동시 취소 5건 중 1건만 성공');
ok(await totalOf(6) === 200, '50 취소 후 200');
const k = key();
const reps = await Promise.all(Array.from({ length: 5 }, () => adm.call('awardScore', { teamNumber: 2, categoryKey: 'jumprope', points: 100, reason: '단체줄넘기 2위', idempotencyKey: k })));
ok(reps.filter((r) => !r.replay).length === 1 && await totalOf(2) === 100, '같은 요청 5번 재전송 → 1번만 반영');
await adm.call('awardScore', { teamNumber: 5, categoryKey: 'cheer', points: 30, reason: '응원 단합', idempotencyKey: key() });
const dup = await adm.call('awardScore', { teamNumber: 5, categoryKey: 'cheer', points: 30, reason: '응원 단합', idempotencyKey: key() }).catch((e) => e);
ok(dup?.details?.code === 'duplicate_warning', '60초 내 같은 내용 반복 → 경고');
await adm.call('awardScore', { teamNumber: 5, categoryKey: 'cheer', points: 30, reason: '응원 단합', idempotencyKey: key(), confirmDuplicate: true });
ok(await totalOf(5) === 60, '확인하면 별도 부여');
const many = await Promise.allSettled([...Array.from({ length: 10 }, (_, i) => adm.call('awardScore', { teamNumber: 4, categoryKey: 'cheer', points: 10, reason: `응원 A${i}`, idempotencyKey: key() })),
  ...Array.from({ length: 10 }, (_, i) => adm2.call('awardScore', { teamNumber: 4, categoryKey: 'cheer', points: 20, reason: `응원 B${i}`, idempotencyKey: key() }))]);
ok(many.every((r) => r.status === 'fulfilled') && await totalOf(4) === 300, '두 관리자 20건 동시 부여 모두 반영 (300점)');
ok((await getDocs(collection(adm.db, 'awards'))).size > 0, '관리자는 점수 읽기 가능');

console.log('\n[7] 권한 변경 즉시 반영');
await owner.call('setRole', { uid: adm2.uid, role: 'participant' });
await rejects(getDocs(collection(adm2.db, 'awards')), '해제된 관리자 → 같은 로그인으로 점수 읽기 즉시 차단', 'permission-denied');
await rejects(adm2.call('awardScore', { teamNumber: 1, categoryKey: 'cheer', points: 10, reason: '해제 후 시도', idempotencyKey: key() }), '해제된 관리자 → 점수 부여 차단', 'permission-denied');
await rejects(owner.call('setRole', { uid: owner.uid, role: 'admin' }), '본인 역할 변경 금지', 'invalid-argument');
await owner.call('changeTeam', { uid: p.uid, teamNumber: 6, reason: '현장 인원 조정' });
await rejects(getDocs(query(collection(p.db, 'messages'), where('channel', '==', 'team:3'))), '조 변경 후 이전 조 방 읽기 차단', 'permission-denied');
ok((await getDocs(query(collection(p.db, 'messages'), where('channel', '==', 'team:6')))).size >= 0, '새 조 방 읽기 가능');
ok((await getDoc(doc(p.db, 'checkins', p.uid))).data().ticket === myTicket, '조 변경 후에도 행운권 그대로');

console.log('\n[8] 행운권 조회(관리자)');
const t = await getDoc(doc(adm.db, 'tickets', String(myTicket)));
ok(t.exists() && t.data().uid === p.uid, `관리자: ${myTicket}번 → 참가일 확인`);
await rejects(getDoc(doc(adm.db, 'employeeIds', p.uid)), '일반 관리자는 사번 읽기 불가', 'permission-denied');
ok((await getDoc(doc(owner.db, 'employeeIds', p.uid))).data().employeeId === 'P-1', 'owner는 사번 확인 가능');

console.log(`\n결과: ${passed} 통과, ${failed} 실패`);
for (const c of [owner, p, adm, adm2, zero, d1, d2, anon]) await deleteApp(c.app).catch(() => {});
process.exit(failed ? 1 : 0);
