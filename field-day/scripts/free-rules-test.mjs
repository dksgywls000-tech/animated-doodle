// 무료 요금제 버전 규칙·동시성 테스트 — Firestore/Auth 에뮬레이터 안에서 실행 (scripts/free-test.sh)
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import * as fs from 'firebase/firestore';
fs.setLogLevel('silent');
import { webcrypto } from 'node:crypto';
const { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, writeBatch, serverTimestamp, getCountFromServer } = fs;

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ✓', m); } else { failed++; console.log('  ✗', m); } };
const rejects = async (p, m) => { try { await p; ok(false, m + ' (거절되지 않음)'); } catch (e) { ok(/permission-denied/.test(e.code), `${m} → ${e.code}`); } };
const hex = async (t) => Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(t))), (b) => b.toString(16).padStart(2, '0')).join('');
const loginKey = (e, n) => hex(`fd26|${e}|${n}`);
const empKey = (e) => hex(`fd26emp|${e.toLowerCase()}`);
const pwHash = (p) => hex(`fd26pw|${p}`);
const rid = () => webcrypto.randomUUID().replace(/-/g, '');
let n = 0;
async function device() {
  const app = initializeApp({ apiKey: 'fake', projectId: 'demo-fieldday', appId: 'x' }, 'd' + n++);
  const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = fs.getFirestore(app); fs.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const user = (await signInAnonymously(auth)).user;
  return { app, db, uid: user.uid };
}
async function bind(c, emp, name) {
  const key = await loginKey(emp, name);
  const idx = await getDoc(doc(c.db, 'loginIndex', key));
  if (!idx.exists()) throw Object.assign(new Error('no index'), { code: 'not-found' });
  await setDoc(doc(c.db, 'bindings', c.uid), { pid: idx.data().pid, key, createdAt: serverTimestamp() });
  c.pid = idx.data().pid;
  return c;
}
// client/free/api.ts의 ensureTicket과 같은 절차
async function ensureTicket(c, team) {
  const db = c.db; const pid = c.pid;
  const ci = await getDoc(doc(db, 'checkins', pid));
  if (ci.exists()) return { ...ci.data(), isNew: false };
  let claim = await getDoc(doc(db, 'claims', pid));
  if (!claim.exists()) {
    let k = (await getCountFromServer(collection(db, 'slots'))).data().count + 1;
    for (let a = 0; a < 400; a++) {
      const b = writeBatch(db);
      b.set(doc(db, 'claims', pid), { seq: k }); b.set(doc(db, 'slots', String(k)), { pid });
      try { await b.commit(); break; } catch (e) {
        if (!/permission-denied|aborted/.test(e.code)) throw e;
        claim = await getDoc(doc(db, 'claims', pid)); if (claim.exists()) break;
        if (a % 8 === 7) k = (await getCountFromServer(collection(db, 'slots'))).data().count + 1; else k += 1;
        await new Promise((r) => setTimeout(r, Math.random() * 120));
      }
    }
    claim = await getDoc(doc(db, 'claims', pid));
  }
  const seq = claim.data().seq;
  const ticket = seq <= 300 ? (await getDoc(doc(db, 'pool', String(seq)))).data().n : seq;
  const b = writeBatch(db);
  b.set(doc(db, 'checkins', pid), { seq, ticket, teamNumber: team, at: serverTimestamp() });
  b.set(doc(db, 'tickets', String(ticket)), { pid, seq });
  for (let a = 0; ; a++) {
    try { await b.commit(); break; } catch (e) { const g = await getDoc(doc(db, 'checkins', pid)); if (g.exists()) return { ...g.data(), isNew: false }; if (!/aborted/.test(e.code) || a > 5) throw e; await new Promise((r) => setTimeout(r, 100 + Math.random() * 300)); }
  }
  return { seq, ticket, isNew: true };
}

console.log('\n[1] 최초 설정');
const o = await device();
const opid = rid(); const okey = await loginKey('O-1', '총괄');
{
  const b = writeBatch(o.db);
  b.set(doc(o.db, 'config', 'public'), { title: 't', schedule: [{ id: 'a', title: '퇴근버스 탑승', startTime: '17:40', public: true, sortOrder: 10 }], announcements: [], statusNote: '' });
  b.set(doc(o.db, 'private', 'settings'), { cancelHash: await pwHash('1234') });
  const pool = Array.from({ length: 300 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
  pool.forEach((v, i) => b.set(doc(o.db, 'pool', String(i + 1)), { n: v }));
  b.set(doc(o.db, 'participants', opid), { name: '총괄', teamNumber: 0, role: 'owner', active: true });
  b.set(doc(o.db, 'employeeIds', opid), { employeeId: 'O-1' });
  b.set(doc(o.db, 'loginIndex', okey), { pid: opid });
  b.set(doc(o.db, 'empIndex', await empKey('O-1')), { pid: opid });
  b.set(doc(o.db, 'bindings', o.uid), { pid: opid, key: okey, createdAt: serverTimestamp() });
  await b.commit();
  o.pid = opid;
  ok(true, '최초 설정 일괄 쓰기(공개문서·풀 300·owner)');
}
const x = await device();
await rejects(setDoc(doc(x.db, 'config', 'public'), { title: 'hack' }), '설정 후 다른 사람이 다시 설정 불가');
await rejects(setDoc(doc(x.db, 'participants', rid()), { name: '해커', teamNumber: 1, role: 'owner', active: true }), '로그인 안 한 사람이 owner 생성 불가');

console.log('\n[2] 명단(owner)·로그인');
const people = [];
{
  const ops = [];
  const add = async (emp, name, team, role = 'participant', active = true) => {
    const pid = rid(); people.push({ emp, name, team, pid, role });
    const lk = await loginKey(emp, name); const ek = await empKey(emp);
    ops.push((b) => { b.set(doc(o.db, 'participants', pid), { name, teamNumber: team, role, active }); b.set(doc(o.db, 'employeeIds', pid), { employeeId: emp }); b.set(doc(o.db, 'loginIndex', lk), { pid }); b.set(doc(o.db, 'empIndex', ek), { pid }); });
  };
  await add('M-1', '관리일', 2, 'admin'); await add('P-1', '참가일', 3); await add('P-2', '참가오', 5); await add('X-1', '비활성', 1, 'participant', false); await add('S-1', '운영원', 0);
  for (let i = 1; i <= 120; i++) await add(`C-${i}`, `참가자${i}`, ((i - 1) % 8) + 1);
  for (let i = 0; i < ops.length; i += 100) { const b = writeBatch(o.db); ops.slice(i, i + 100).forEach((f) => f(b)); await b.commit(); }
  ok(true, `owner가 명단 ${people.length}명 등록`);
}
const p = await bind(await device(), 'P-1', '참가일');
ok(!!p.pid, '이름+사번 일치 → 연결');
let err = await bind(await device(), 'P-2', '참가일').catch((e) => e); ok(err?.code === 'not-found', '다른 사람 사번과 섞으면 실패');
err = await bind(await device(), 'X-1', '비활성').catch((e) => e); ok(/permission-denied/.test(err?.code), '비활성은 연결 거절');
const fake = await device();
await rejects(setDoc(doc(fake.db, 'bindings', fake.uid), { pid: people[0].pid, key: 'deadbeef', createdAt: serverTimestamp() }), '키 없이 관리자 계정에 연결 시도 차단');
await rejects(getDocs(collection(fake.db, 'loginIndex')), '로그인 목록 전체 조회 차단');

console.log('\n[3] 행운권');
const ticketP = await ensureTicket(p, 3);
ok(ticketP.isNew && ticketP.seq === 1, `첫 입장 → 순번 1, 번호 ${ticketP.ticket}`);
ok((await ensureTicket(p, 3)).ticket === ticketP.ticket, '다시 해도 같은 번호');
await rejects(getDoc(doc(p.db, 'pool', '2')), '남의 순번 풀 번호 열람 차단');
await rejects(getDocs(collection(p.db, 'tickets')), '행운권 목록 열람 차단');
// 조작 시도: 내 순번이 아닌 번호로 체크인
const cheat = await bind(await device(), 'P-2', '참가오');
{
  const b = writeBatch(cheat.db);
  b.set(doc(cheat.db, 'claims', cheat.pid), { seq: 5 }); b.set(doc(cheat.db, 'slots', '5'), { pid: cheat.pid });
  await rejects(b.commit(), '순번 건너뛰기(빈칸 만들기) 차단');
  const b2 = writeBatch(cheat.db);
  b2.set(doc(cheat.db, 'claims', cheat.pid), { seq: 2 }); b2.set(doc(cheat.db, 'slots', '2'), { pid: cheat.pid });
  await b2.commit();
  const b3 = writeBatch(cheat.db);
  b3.set(doc(cheat.db, 'checkins', cheat.pid), { seq: 2, ticket: 1, teamNumber: 5, at: serverTimestamp() }); b3.set(doc(cheat.db, 'tickets', '1'), { pid: cheat.pid, seq: 2 });
  await rejects(b3.commit(), '원하는 번호(1번)로 바꿔치기 차단');
  const b4 = writeBatch(cheat.db);
  b4.set(doc(cheat.db, 'claims', cheat.pid), { seq: 3 });
  await rejects(b4.commit(), '두 번째 순번 선점 차단');
  const t2 = await ensureTicket(cheat, 5);
  ok(t2.seq === 2, `정상 절차로는 순번 2, 번호 ${t2.ticket}`);
}
console.log('  … 동시 입장 100명 (서로 다른 기기)');
const crowd = await Promise.all(people.filter((x) => x.emp.startsWith('C-')).slice(0, 100).map(async (x) => bind(await device(), x.emp, x.name)));
const t0 = Date.now();
const res = await Promise.allSettled(crowd.map((c, i) => ensureTicket(c, ((i) % 8) + 1)));
ok(res.every((r) => r.status === 'fulfilled'), `100명 동시 입장 모두 성공 (${((Date.now() - t0) / 1000).toFixed(1)}초)`);
if (!res.every((r) => r.status === 'fulfilled')) console.log(res.filter((r) => r.status === 'rejected').slice(0, 2).map((r) => r.reason?.message));
const oc = await getDocs(collection(o.db, 'checkins'));
const seqs = oc.docs.map((d) => d.data().seq).sort((a, b) => a - b);
ok(seqs.every((v, i) => v === i + 1), `순번 1~${seqs.length} 빈틈·중복 없음`);
ok(new Set(oc.docs.map((d) => d.data().ticket)).size === oc.size, '번호 중복 없음');
ok(oc.docs.every((d) => d.data().seq > 300 || d.data().ticket >= 1 && d.data().ticket <= 300), '300번째까지는 1~300 안의 번호');

console.log('\n[4] 참가자 권한');
await rejects(getDocs(collection(p.db, 'awards')), '참가자 점수 읽기 차단');
await rejects(getDocs(collection(p.db, 'participants')), '전체 명단 읽기 차단');
await rejects(getDoc(doc(p.db, 'employeeIds', people[0].pid)), '타인 사번 읽기 차단');
await rejects(getDoc(doc(p.db, 'checkins', people[0].pid)), '타인 행운권 읽기 차단');
await rejects(getDoc(doc(p.db, 'private', 'settings')), '취소 비밀번호 설정 읽기 차단');
await rejects(updateDoc(doc(p.db, 'participants', p.pid), { role: 'admin' }), '자기 역할 변경 차단');
await rejects(setDoc(doc(p.db, 'awards', 'hack123456'), { teamNumber: 3, categoryKey: 'cheer', subtypeKey: null, points: 200, reason: '해킹시도', actorId: p.pid, actorName: '참가일', createdAt: serverTimestamp() }), '참가자 점수 부여 차단');
ok((await getDoc(doc(p.db, 'config', 'public'))).data().schedule[0].startTime === '17:40', '공개 일정 읽기 가능');

console.log('\n[5] 채팅');
const send = (c, coll, body, extra = {}) => {
  const b = writeBatch(c.db);
  b.set(doc(c.db, coll, `${c.pid}_${rid()}`), { senderId: c.pid, senderName: extra.name ?? '참가일', senderTeam: extra.team ?? 3, staff: false, body, createdAt: serverTimestamp(), deletedAt: null, hiddenAt: null });
  b.set(doc(c.db, 'rate', c.pid), { lastAt: serverTimestamp() });
  return b.commit();
};
await send(p, 'chat_team_3', '3조 화이팅'); ok(true, '자기 조 방 전송');
await rejects(send(p, 'chat_all', '연속'), '1초 안 연속 전송 차단');
await new Promise((r) => setTimeout(r, 1100));
await rejects(send(p, 'chat_team_5', '침입'), '다른 조 방 쓰기 차단');
await new Promise((r) => setTimeout(r, 1100));
await rejects(send(p, 'chat_all', '사칭', { name: '관리일' }), '이름 사칭 차단');
await rejects(getDocs(collection(p.db, 'chat_team_5')), '다른 조 방 읽기 차단');
ok((await getDocs(collection(p.db, 'chat_team_3'))).size === 1, '자기 조 방 읽기');

console.log('\n[6] 점수');
const adm = await bind(await device(), 'M-1', '관리일');
const award = (c, key, data) => setDoc(doc(c.db, 'awards', key), { teamNumber: 3, categoryKey: 'cheer', subtypeKey: null, points: 100, reason: '응원 열정', actorId: c.pid, actorName: '관리일', createdAt: serverTimestamp(), ...data });
await award(adm, 'award000001', {}); ok(true, '관리자 점수 부여');
for (const v of [15, 0, -10, 210, '100', 10.5]) await rejects(award(adm, 'bad' + rid().slice(0, 10), { points: v }), `잘못된 점수 ${JSON.stringify(v)} 차단`);
await rejects(award(adm, 'evt' + rid().slice(0, 10), { categoryKey: 'event', subtypeKey: null }), '이벤트 세부유형 없으면 차단');
await rejects(award(adm, 'award000001', { points: 200 }), '같은 기록 덮어쓰기 차단');
const cancel = async (c, awardId, pw) => {
  const checkId = rid(); const b = writeBatch(c.db);
  b.set(doc(c.db, 'cancelChecks', checkId), { pwHash: await pwHash(pw), actorId: c.pid, createdAt: serverTimestamp() });
  b.set(doc(c.db, 'reversals', awardId), { awardId, points: -100, reason: '입력 실수', actorId: c.pid, actorName: c === o ? '총괄' : '관리일', checkId, createdAt: serverTimestamp() });
  return b.commit();
};
await rejects(cancel(adm, 'award000001', '0000'), '틀린 비밀번호 취소 차단');
const pc = writeBatch(p.db); pc.set(doc(p.db, 'cancelChecks', rid()), { pwHash: await pwHash('1234'), actorId: p.pid, createdAt: serverTimestamp() });
await rejects(pc.commit(), '참가자는 1234를 알아도 취소 불가');
const both = await Promise.allSettled([cancel(adm, 'award000001', '1234'), cancel(o, 'award000001', '1234')]);
ok(both.filter((r) => r.status === 'fulfilled').length === 1, '동시 취소 2건 중 1건만 성공');
ok((await getDoc(doc(adm.db, 'reversals', 'award000001'))).data().points === -100, '정확히 -100 상쇄');

console.log('\n[7] 권한 변경·인원 추가·초기화');
await updateDoc(doc(o.db, 'participants', adm.pid), { role: 'participant' });
await rejects(getDocs(collection(adm.db, 'awards')), '관리자 해제 즉시 점수 읽기 차단');
await updateDoc(doc(o.db, 'participants', adm.pid), { role: 'admin' });
await rejects(updateDoc(doc(o.db, 'participants', o.pid), { role: 'admin' }), 'owner 본인 강등 차단');
{
  const pid = rid(); const b = writeBatch(adm.db);
  b.set(doc(adm.db, 'participants', pid), { name: '현장추가', teamNumber: 4, role: 'participant', active: true });
  b.set(doc(adm.db, 'employeeIds', pid), { employeeId: '900001' });
  b.set(doc(adm.db, 'loginIndex', await loginKey('900001', '현장추가')), { pid });
  b.set(doc(adm.db, 'empIndex', await empKey('900001')), { pid });
  await b.commit();
  const nn = await bind(await device(), '900001', '현장추가');
  ok(!!nn.pid, '관리자가 추가한 사람 바로 입장');
  const pid2 = rid(); const b2 = writeBatch(adm.db);
  b2.set(doc(adm.db, 'participants', pid2), { name: '가짜관리', teamNumber: 4, role: 'admin', active: true });
  await rejects(b2.commit(), '일반 관리자는 관리자 추가 불가');
  const b3 = writeBatch(adm.db);
  b3.set(doc(adm.db, 'loginIndex', await loginKey('hack', '해커')), { pid: o.pid });
  await rejects(b3.commit(), '관리자가 owner 계정으로 들어가는 키 만들기 차단');
  const pid4 = rid(); const b4 = writeBatch(adm.db);
  b4.set(doc(adm.db, 'participants', pid4), { name: '중복', teamNumber: 1, role: 'participant', active: true });
  b4.set(doc(adm.db, 'empIndex', await empKey('900001')), { pid: pid4 });
  await rejects(b4.commit(), '같은 사번 중복 추가 차단');
}
// 초기화(owner)
const reset = async () => {
  const ops = [];
  for (const col of ['checkins', 'tickets', 'claims', 'slots']) (await getDocs(collection(o.db, col))).docs.forEach((d) => ops.push((b) => b.delete(d.ref)));
  Array.from({ length: 300 }, (_, i) => i + 1).sort(() => Math.random() - 0.5).forEach((v, i) => ops.push((b) => b.set(doc(o.db, 'pool', String(i + 1)), { n: v })));
  for (let i = 0; i < ops.length; i += 400) { const b = writeBatch(o.db); ops.slice(i, i + 400).forEach((f) => f(b)); await b.commit(); }
};
await rejects(deleteDoc(doc(adm.db, 'checkins', p.pid)), '관리자는 행운권 삭제 불가(owner만)');
await reset();
ok((await getCountFromServer(collection(o.db, 'checkins'))).data().count === 0, 'owner 초기화 → 행운권 0장');
const again = await ensureTicket(p, 3);
ok(again.isNew && again.seq === 1, '초기화 후 다시 입장 → 순번 1부터 새 번호');

console.log(`\n결과: ${passed} 통과, ${failed} 실패`);
process.exit(failed ? 1 : 0);
