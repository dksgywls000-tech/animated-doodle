import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addParticipants, bulkParticipants, createTestContext, loginAs, req, type TestCtx } from './helpers.js';
import { ensureCheckin } from '../server/services/checkin.js';
import { LOGIN_FAILED_MESSAGE } from '../server/util.js';

let ctx: TestCtx;
const EV = 'test-event';

beforeAll(async () => {
  ctx = await createTestContext();
  await addParticipants(ctx.db, EV, [
    { employeeId: 'A-001', name: '홍길동', team: 3 },
    { employeeId: 'A-002', name: '김철수', team: 5 },
    { employeeId: 'A-003', name: '동명이', team: 1 },
    { employeeId: 'A-004', name: '동명이', team: 7 },
    { employeeId: '000123', name: '영시작', team: 2 },
    { employeeId: 'A-009', name: '비활성', team: 4, active: false },
    { employeeId: 'A-010', name: '띄어 쓰기', team: 6 },
  ]);
});
afterAll(async () => { await ctx.close(); });

const login = (name: string, employeeId: string, ip = '10.1.1.1') =>
  ctx.app.inject({ method: 'POST', url: '/api/login', payload: { name, employeeId }, remoteAddress: ip });

describe('로그인 검증', () => {
  it('올바른 이름+사번은 통과하고 사전 배정된 조를 돌려준다', async () => {
    const s = await loginAs(ctx.app, '홍길동', 'A-001');
    const me = (await req(ctx.app, s, 'GET', '/api/me')).json();
    expect(me.teamNumber).toBe(3);
    expect(me.name).toBe('홍길동');
    expect(me.ticketNumber).toBeGreaterThanOrEqual(1);
  });

  it('잘못된 쌍·미등록·비활성은 같은 문구로 거절', async () => {
    for (const [n, e] of [['홍길동', 'A-999'], ['없는사람', 'Z-1'], ['비활성', 'A-009']]) {
      const r = await login(n, e, '10.9.9.' + Math.floor(Math.random() * 200));
      expect(r.statusCode).toBe(401);
      expect(r.json().error.message).toBe(LOGIN_FAILED_MESSAGE);
    }
  });

  it('다른 행의 이름+사번을 섞으면 거절', async () => {
    const r = await login('홍길동', 'A-002', '10.2.2.2');
    expect(r.statusCode).toBe(401);
  });

  it('동명이인은 각자 사번으로 정확한 계정에 연결', async () => {
    const s1 = await loginAs(ctx.app, '동명이', 'A-003');
    const s2 = await loginAs(ctx.app, '동명이', 'A-004');
    const m1 = (await req(ctx.app, s1, 'GET', '/api/me')).json();
    const m2 = (await req(ctx.app, s2, 'GET', '/api/me')).json();
    expect(m1.teamNumber).toBe(1);
    expect(m2.teamNumber).toBe(7);
    expect(m1.id).not.toBe(m2.id);
  });

  it('앞자리 0 사번 보존 — 000123은 되고 123은 안 된다', async () => {
    expect((await login('영시작', '123', '10.3.3.3')).statusCode).toBe(401);
    expect((await login('영시작', '000123', '10.3.3.3')).statusCode).toBe(200);
  });

  it('앞뒤 공백은 제거, 내부 공백은 그대로 비교, NFC 정규화', async () => {
    expect((await login('  띄어 쓰기  ', ' A-010 ', '10.4.4.4')).statusCode).toBe(200);
    expect((await login('띄어쓰기', 'A-010', '10.4.4.5')).statusCode).toBe(401);
    // NFD로 입력된 한글도 NFC로 맞춘다
    expect((await login('홍길동'.normalize('NFD'), 'A-001', '10.4.4.6')).statusCode).toBe(200);
  });

  it('반복 실패 시 대기 안내(429), 다른 IP의 정상 사용자는 영향 없음', async () => {
    for (let i = 0; i < 5; i++) expect((await login('김철수', 'A-002x', '10.5.5.5')).statusCode).toBe(401);
    const blocked = await login('김철수', 'A-002x', '10.5.5.5');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.message).toContain('분 후');
    expect((await login('김철수', 'A-002', '10.6.6.6')).statusCode).toBe(200);
  });

  it('/api/me 응답에는 점수·순위·기록 필드가 없다', async () => {
    const s = await loginAs(ctx.app, '김철수', 'A-002', '10.7.7.7');
    const body = (await req(ctx.app, s, 'GET', '/api/me')).body;
    expect(body).not.toMatch(/score|rank|history|points|total/i);
    const me = JSON.parse(body);
    expect(me.employeeIdMasked).not.toBe('A-002');
  });

  it('재로그인·다중 기기 로그인에도 행운권 불변', async () => {
    const a = await loginAs(ctx.app, '홍길동', 'A-001', '10.8.0.1');
    const b = await loginAs(ctx.app, '홍길동', 'A-001', '10.8.0.2');
    const t1 = (await req(ctx.app, a, 'GET', '/api/me')).json().ticketNumber;
    const t2 = (await req(ctx.app, b, 'GET', '/api/me')).json().ticketNumber;
    await req(ctx.app, a, 'POST', '/api/logout');
    const c = await loginAs(ctx.app, '홍길동', 'A-001', '10.8.0.3');
    const t3 = (await req(ctx.app, c, 'GET', '/api/me')).json().ticketNumber;
    expect(t1).toBe(t2);
    expect(t1).toBe(t3);
    expect((await req(ctx.app, a, 'GET', '/api/me')).statusCode).toBe(401);
  });

  it('실패한 로그인·명단 업로드만으로는 체크인되지 않는다', async () => {
    const { rows } = await ctx.db.query(`SELECT count(*) AS n FROM checkins c JOIN participants p ON p.id=c.participant_id WHERE p.employee_id IN ('A-009','Z-1')`);
    expect(Number(rows[0].n)).toBe(0);
  });
});

describe('행운권 배정 — 동시성', () => {
  it('350명 동시 최초 로그인: 1~350 유일, 1~300순번은 셔플, 이후는 순번 그대로', async () => {
    const people = await bulkParticipants(ctx.db, EV, 350, 'C');
    const before = await ctx.db.query(`SELECT next_sequence FROM allocation_state WHERE event_id=$1`, [EV]);
    const startSeq = before.rows[0].next_sequence as number;
    // 실제 HTTP 로그인 경로로 동시에 (IP는 공용 Wi-Fi처럼 같게)
    const results = await Promise.all(people.map((p) => login(p.name, p.employee_id, '172.16.0.1')));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const { rows } = await ctx.db.query(`SELECT checkin_sequence, ticket_number FROM checkins WHERE event_id=$1 ORDER BY checkin_sequence`, [EV]);
    const total = rows.length;
    expect(total).toBe(startSeq - 1 + 350);
    const seqs = rows.map((r) => r.checkin_sequence);
    expect(seqs).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    const tickets = rows.map((r) => r.ticket_number);
    expect(new Set(tickets).size).toBe(total);
    const first300 = rows.filter((r) => r.checkin_sequence <= 300).map((r) => r.ticket_number).sort((a, b) => a - b);
    expect(first300).toEqual(Array.from({ length: 300 }, (_, i) => i + 1));
    for (const r of rows.filter((r) => r.checkin_sequence > 300)) expect(r.ticket_number).toBe(r.checkin_sequence);
    // 셔플 확인: 1~300 구간이 순번과 같은 경우가 대부분이면 셔플되지 않은 것
    const same = rows.filter((r) => r.checkin_sequence <= 300 && r.ticket_number === r.checkin_sequence).length;
    expect(same).toBeLessThan(20);
    expect(rows.find((r) => r.checkin_sequence === 301)!.ticket_number).toBe(301);
    expect(rows.find((r) => r.checkin_sequence === 350)!.ticket_number).toBe(350);
  });

  it('동일 참가자 10개 동시 요청에도 체크인·번호 하나', async () => {
    const [p] = await bulkParticipants(ctx.db, EV, 1, 'D');
    const results = await Promise.all(Array.from({ length: 10 }, () => login(p.name, p.employee_id, '172.16.0.2')));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const { rows } = await ctx.db.query(`SELECT count(*) AS n FROM checkins WHERE participant_id=$1`, [p.id]);
    expect(Number(rows[0].n)).toBe(1);
    const seq = await ctx.db.query(`SELECT max(checkin_sequence) AS m, count(*) AS n FROM checkins WHERE event_id=$1`, [EV]);
    expect(Number(seq.rows[0].m)).toBe(Number(seq.rows[0].n)); // 순번에 구멍 없음
  });

  it('트랜잭션 실패 시 체크인·카운터 롤백, 재시도 시 정상 배정', async () => {
    const [p] = await bulkParticipants(ctx.db, EV, 1, 'E');
    const before = (await ctx.db.query(`SELECT next_sequence FROM allocation_state WHERE event_id=$1`, [EV])).rows[0].next_sequence;
    await expect(ensureCheckin(ctx.db, EV, p.id, { beforeInsert: () => { throw new Error('injected'); } })).rejects.toThrow('injected');
    const mid = (await ctx.db.query(`SELECT next_sequence FROM allocation_state WHERE event_id=$1`, [EV])).rows[0].next_sequence;
    expect(mid).toBe(before);
    expect((await ctx.db.query(`SELECT 1 FROM checkins WHERE participant_id=$1`, [p.id])).rowCount).toBe(0);
    const r1 = await ensureCheckin(ctx.db, EV, p.id);
    const r2 = await ensureCheckin(ctx.db, EV, p.id); // 응답 유실 후 재시도
    expect(r1.checkinSequence).toBe(before);
    expect(r2.ticketNumber).toBe(r1.ticketNumber);
    expect(r2.isNew).toBe(false);
  });

  it('비활성화·명단 재업로드 후 재활성 로그인에도 번호 유지', async () => {
    const [p] = await bulkParticipants(ctx.db, EV, 1, 'F');
    const s = await loginAs(ctx.app, p.name, p.employee_id, '172.16.0.3');
    const t = (await req(ctx.app, s, 'GET', '/api/me')).json().ticketNumber;
    await ctx.db.query(`UPDATE participants SET active=false WHERE id=$1`, [p.id]);
    expect((await req(ctx.app, s, 'GET', '/api/me')).statusCode).toBe(401);
    expect((await login(p.name, p.employee_id, '172.16.0.3')).statusCode).toBe(401);
    await ctx.db.query(`UPDATE participants SET active=true WHERE id=$1`, [p.id]);
    const s2 = await loginAs(ctx.app, p.name, p.employee_id, '172.16.0.3');
    expect((await req(ctx.app, s2, 'GET', '/api/me')).json().ticketNumber).toBe(t);
  });
});

describe('행운권 경계 299/300/301 (새 행사)', () => {
  let c2: TestCtx;
  beforeAll(async () => { c2 = await createTestContext(); });
  afterAll(async () => { await c2.close(); });

  it('298명 체크인 후 3명 동시 → 299·300은 남은 풀 번호, 301은 301', async () => {
    const people = await bulkParticipants(c2.db, EV, 301, 'B');
    for (const p of people.slice(0, 298)) await ensureCheckin(c2.db, EV, p.id);
    const used = new Set((await c2.db.query(`SELECT ticket_number FROM checkins WHERE event_id=$1`, [EV])).rows.map((r) => r.ticket_number));
    const remaining = Array.from({ length: 300 }, (_, i) => i + 1).filter((n) => !used.has(n));
    expect(remaining.length).toBe(2);
    const res = await Promise.all(people.slice(298).map((p) => ensureCheckin(c2.db, EV, p.id)));
    const bySeq = Object.fromEntries(res.map((r) => [r.checkinSequence, r.ticketNumber]));
    expect(Object.keys(bySeq).map(Number).sort()).toEqual([299, 300, 301]);
    expect([bySeq[299], bySeq[300]].sort((a, b) => a - b)).toEqual(remaining);
    expect(bySeq[301]).toBe(301);
  });

  it('풀 번호·시드는 어떤 참가자 API로도 노출되지 않는다', async () => {
    await addParticipants(c2.db, EV, [{ employeeId: 'X-1', name: '확인용', team: 1 }]);
    const s = await loginAs(c2.app, '확인용', 'X-1');
    for (const url of ['/api/me', '/api/home', '/api/schedule', '/api/games', '/api/announcements']) {
      const body = (await req(c2.app, s, 'GET', url)).body;
      expect(body).not.toMatch(/ticket_pool|pool|position|checkin_sequence|checkinSequence/);
    }
  });
});
