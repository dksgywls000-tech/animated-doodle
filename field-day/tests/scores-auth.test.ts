import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addParticipants, createTestContext, key, loginAs, req, type Session, type TestCtx } from './helpers.js';
import { createAward, cancelAward } from '../server/services/scores.js';
import { loadSession } from '../server/services/auth.js';

let ctx: TestCtx;
const EV = 'test-event';
let admin: Session, admin2: Session, owner: Session, part: Session;
let partId: string, adminId: string;

beforeAll(async () => {
  ctx = await createTestContext();
  const ids = await addParticipants(ctx.db, EV, [
    { employeeId: 'O-1', name: '오너', team: 1, role: 'owner' },
    { employeeId: 'M-1', name: '관리일', team: 2, role: 'admin' },
    { employeeId: 'M-2', name: '관리이', team: 4, role: 'admin' },
    { employeeId: 'P-1', name: '참가일', team: 3 },
  ]);
  [, adminId, , partId] = ids;
  owner = await loginAs(ctx.app, '오너', 'O-1');
  admin = await loginAs(ctx.app, '관리일', 'M-1');
  admin2 = await loginAs(ctx.app, '관리이', 'M-2');
  part = await loginAs(ctx.app, '참가일', 'P-1');
});
afterAll(async () => { await ctx.close(); });

const award = (s: Session, body: Record<string, unknown>) => req(ctx.app, s, 'POST', '/api/admin/scores/awards', { idempotencyKey: key(), ...body });
const total = async (team: number) => (await req(ctx.app, admin, 'GET', '/api/admin/scores/board')).json().teams.find((t: any) => t.teamNumber === team).total;

describe('참가자 권한 차단', () => {
  const adminUrls = [
    ['GET', '/api/admin/scores/board'], ['GET', '/api/admin/scores/log'], ['GET', '/api/admin/scores/export.csv'],
    ['GET', '/api/admin/scores/categories'], ['GET', '/api/admin/checkins'], ['GET', '/api/admin/help'],
    ['GET', '/api/admin/chat/team/5'], ['GET', '/api/owner/audit'], ['GET', '/api/owner/export/checkins.csv'],
    ['POST', '/api/admin/scores/awards'], ['POST', '/api/owner/roster/preview'],
  ];
  it('participant가 관리자·owner API를 호출하면 403, 점수 바이트 없음', async () => {
    await award(admin, { teamNumber: 3, categoryKey: 'jumprope', points: 100, reason: '단체줄넘기 2위' });
    for (const [m, u] of adminUrls) {
      const r = await req(ctx.app, part, m, u, m === 'POST' ? {} : undefined);
      expect(r.statusCode, u).toBe(403);
      expect(r.body).not.toMatch(/total|points|rank|"100"/);
    }
  });
  it('비로그인은 401', async () => {
    const r = await req(ctx.app, null, 'GET', '/api/admin/scores/board');
    expect(r.statusCode).toBe(401);
  });
  it('일반 admin은 owner API 불가', async () => {
    expect((await req(ctx.app, admin, 'GET', '/api/owner/audit')).statusCode).toBe(403);
  });
  it('클라이언트가 role/team_id를 보내도 무시된다', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/api/admin/scores/board?role=admin', headers: { cookie: part.cookie + '; role=admin; team_id=1', 'x-role': 'admin' } });
    expect(r.statusCode).toBe(403);
    const fake = await ctx.app.inject({ method: 'POST', url: '/api/login', payload: { name: '참가일', employeeId: 'P-1', role: 'owner', teamNumber: 1 } });
    const s = { cookie: (fake.headers['set-cookie'] as string).split(';')[0], csrf: fake.json().csrfToken };
    const me = (await req(ctx.app, s, 'GET', '/api/me')).json();
    expect(me.role).toBe('participant');
    expect(me.teamNumber).toBe(3);
  });
  it('참가자 공개 API 응답에 점수 정보가 섞이지 않는다', async () => {
    for (const u of ['/api/me', '/api/home', '/api/schedule', '/api/games', '/api/announcements', '/api/chat/all/messages', '/api/chat/team/messages']) {
      const body = (await req(ctx.app, part, 'GET', u)).body;
      expect(body, u).not.toMatch(/"(score|scores|total|rank|points|history)"/);
      expect(body, u).not.toMatch(/200점|100점|50점/);
    }
  });
  it('CSRF 토큰 없는 변경 요청 거절', async () => {
    const r = await ctx.app.inject({ method: 'POST', url: '/api/admin/scores/awards', headers: { cookie: admin.cookie }, payload: { teamNumber: 1, categoryKey: 'cheer', points: 10, reason: '응원 우수', idempotencyKey: key() } });
    expect(r.statusCode).toBe(403);
    const r2 = await ctx.app.inject({ method: 'POST', url: '/api/admin/scores/awards', headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf, origin: 'https://evil.example' }, payload: {} });
    expect(r2.statusCode).toBe(403);
  });
});

describe('점수 부여·취소', () => {
  it('200+50=250, 50 취소 후 200', async () => {
    const a = await award(admin, { teamNumber: 6, categoryKey: 'balloon', points: 200, reason: '풍선기둥 1위' });
    expect(a.statusCode).toBe(200);
    const b = await award(admin, { teamNumber: 6, categoryKey: 'cheer', points: 50, reason: '응원 열정 최고' });
    expect(await total(6)).toBe(250);
    const c = await req(ctx.app, admin, 'POST', `/api/admin/scores/awards/${b.json().award.id}/cancel`, { password: '1234', reason: '입력 실수', idempotencyKey: key() });
    expect(c.statusCode).toBe(200);
    expect(c.json().reversal.points).toBe(-50);
    expect(await total(6)).toBe(200);
  });

  it('비밀번호 오류 시 합계 변화 없음, 참가자는 1234를 알아도 불가', async () => {
    const a = await award(admin, { teamNumber: 7, categoryKey: 'tuberelay', points: 100, reason: '튜브릴레이 2위' });
    const id = a.json().award.id;
    const bad = await req(ctx.app, admin2, 'POST', `/api/admin/scores/awards/${id}/cancel`, { password: '0000', reason: '테스트', idempotencyKey: key() });
    expect(bad.statusCode).toBe(403);
    expect(bad.body).not.toContain('1234');
    expect(await total(7)).toBe(100);
    const p = await req(ctx.app, part, 'POST', `/api/admin/scores/awards/${id}/cancel`, { password: '1234', reason: '해킹', idempotencyKey: key() });
    expect(p.statusCode).toBe(403);
    expect(await total(7)).toBe(100);
    const audit = await ctx.db.query(`SELECT detail::text FROM audit_events`);
    expect(JSON.stringify(audit.rows)).not.toContain('0000');
  });

  it('비밀번호 반복 오류는 제한', async () => {
    await addParticipants(ctx.db, EV, [{ employeeId: 'M-3', name: '관리삼', team: 6, role: 'admin' }]);
    const admin3 = await loginAs(ctx.app, '관리삼', 'M-3');
    const a = await award(admin3, { teamNumber: 8, categoryKey: 'cheer', points: 10, reason: '응원 박수' });
    const id = a.json().award.id;
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await req(ctx.app, admin3, 'POST', `/api/admin/scores/awards/${id}/cancel`, { password: 'x' + i, reason: '시도', idempotencyKey: key() })).statusCode);
    expect(codes.slice(0, 5)).toEqual([403, 403, 403, 403, 403]);
    expect(codes[5]).toBe(429);
    // 제한 중에는 맞는 비밀번호도 거절되고 점수는 그대로
    const ok = await req(ctx.app, admin3, 'POST', `/api/admin/scores/awards/${id}/cancel`, { password: '1234', reason: '시도', idempotencyKey: key() });
    expect(ok.statusCode).toBe(429);
  });

  it('잘못된 점수값 거절: 15/0/음수/201/문자/소수', async () => {
    for (const points of [15, 0, -10, 201, 210, '100', 10.5, null]) {
      const r = await award(admin2, { teamNumber: 1, categoryKey: 'cheer', points, reason: '응원 테스트' });
      expect(r.statusCode, String(points)).toBe(400);
    }
    for (const p of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200]) {
      // DB CHECK도 동일 규칙
      await expect(ctx.db.query(`SELECT ${p} BETWEEN 10 AND 200 AND ${p} % 10 = 0 AS ok`).then((r) => r.rows[0].ok)).resolves.toBe(true);
    }
    await expect(ctx.db.query(`INSERT INTO score_awards (event_id, team_number, category_key, points, reason, actor_id, actor_name, idempotency_key)
      VALUES ($1,1,'cheer',15,'x',$2,'x','directdbkey1')`, [EV, adminId])).rejects.toThrow();
  });

  it('이벤트는 세부유형·구체 사유 필수, 공백 사유 거절', async () => {
    expect((await award(admin, { teamNumber: 1, categoryKey: 'event', points: 50, reason: '제기차기 3명 성공' })).statusCode).toBe(400);
    expect((await award(admin, { teamNumber: 1, categoryKey: 'event', subtypeKey: 'jegi', points: 50, reason: '   ' })).statusCode).toBe(400);
    expect((await award(admin, { teamNumber: 1, categoryKey: 'cheer', points: 50, reason: '응' })).statusCode).toBe(400);
    const ok = await award(admin, { teamNumber: 1, categoryKey: 'event', subtypeKey: 'jegi', points: 50, reason: '제기차기 1명 합산 초과' });
    expect(ok.statusCode).toBe(200);
  });

  it('같은 idempotency key 재시도는 한 번만 반영', async () => {
    const k = key();
    const body = { teamNumber: 2, categoryKey: 'ballbounce', points: 50, reason: '공 튕기기 3위', idempotencyKey: k };
    const before = await total(2);
    const rs = await Promise.all(Array.from({ length: 5 }, () => req(ctx.app, admin, 'POST', '/api/admin/scores/awards', body)));
    expect(rs.every((r) => r.statusCode === 200)).toBe(true);
    expect(rs.filter((r) => r.json().replay === false).length).toBe(1);
    expect(await total(2)).toBe(before + 50);
  });

  it('짧은 시간 같은 내용 반복은 경고, 명시 확인 시 별도 부여', async () => {
    const body = { teamNumber: 5, categoryKey: 'cheer', points: 30, reason: '응원 단합 우수' };
    expect((await award(admin, body)).statusCode).toBe(200);
    const warn = await award(admin, body);
    expect(warn.statusCode).toBe(409);
    expect(warn.json().error.code).toBe('duplicate_warning');
    expect((await award(admin, { ...body, confirmDuplicate: true })).statusCode).toBe(200);
    expect(await total(5)).toBe(60);
  });

  it('서로 다른 관리자 동시 정상 부여는 모두 반영', async () => {
    const before = await total(4);
    const rs = await Promise.all([
      ...Array.from({ length: 10 }, (_, i) => award(admin, { teamNumber: 4, categoryKey: 'cheer', points: 10, reason: `응원 관리일 ${i}` })),
      ...Array.from({ length: 10 }, (_, i) => award(admin2, { teamNumber: 4, categoryKey: 'cheer', points: 20, reason: `응원 관리이 ${i}` })),
    ]);
    expect(rs.every((r) => r.statusCode === 200)).toBe(true);
    expect(await total(4)).toBe(before + 100 + 200);
  });

  it('같은 기록 동시 취소는 한 번만 상쇄, 재취소 불가', async () => {
    const a = await award(admin, { teamNumber: 3, categoryKey: 'balloon', points: 200, reason: '풍선기둥 1위' });
    const id = a.json().award.id;
    const before = await total(3);
    const rs = await Promise.all([admin, admin2, owner, admin, admin2].map((s) =>
      req(ctx.app, s, 'POST', `/api/admin/scores/awards/${id}/cancel`, { password: '1234', reason: '중복 입력', idempotencyKey: key() })));
    expect(rs.filter((r) => r.statusCode === 200).length).toBe(1);
    expect(rs.filter((r) => r.statusCode === 409).length).toBe(4);
    expect(await total(3)).toBe(before - 200);
    const again = await req(ctx.app, admin, 'POST', `/api/admin/scores/awards/${id}/cancel`, { password: '1234', reason: '또 취소', idempotencyKey: key() });
    expect(again.statusCode).toBe(409);
    const n = await ctx.db.query(`SELECT count(*) AS n FROM score_reversals WHERE award_id=$1`, [id]);
    expect(Number(n.rows[0].n)).toBe(1);
  });

  it('원장은 수정·삭제 불가 (DB 트리거)', async () => {
    await expect(ctx.db.query(`UPDATE score_awards SET points=200`)).rejects.toThrow(/immutable/);
    await expect(ctx.db.query(`DELETE FROM score_awards`)).rejects.toThrow(/immutable/);
  });

  it('로그: 원부여자·취소자 구분, 취소 행 보존, 새 연결(재시작) 후 동일 합계', async () => {
    const log = (await req(ctx.app, admin, 'GET', '/api/admin/scores/log')).json().entries;
    const cancelled = log.filter((e: any) => e.status === 'cancelled');
    expect(cancelled.length).toBeGreaterThan(0);
    const c = cancelled.find((e: any) => e.teamNumber === 6);
    expect(c.actorName).toBe('관리일');
    expect(c.reversal.actorName).toBe('관리일');
    const t3 = cancelled.find((e: any) => e.teamNumber === 3 && e.points === 200);
    expect(t3.actorName).toBe('관리일');
    expect(t3.reversal.points).toBe(-200);
    const board1 = (await req(ctx.app, admin, 'GET', '/api/admin/scores/board')).json().teams;
    // 서버 재시작 흉내: 새 앱 인스턴스·새 커넥션 풀
    const { buildApp } = await import('../server/app.js');
    const { createPool } = await import('../server/db.js');
    const db2 = createPool(ctx.url, 5);
    const { app: app2 } = await buildApp(ctx.config, db2, { serveClient: false, logger: false });
    const board2 = (await app2.inject({ method: 'GET', url: '/api/admin/scores/board', headers: { cookie: admin.cookie } })).json().teams;
    expect(board2).toEqual(board1);
    // 원장 재계산과 일치
    const ledger = await ctx.db.query(`SELECT team_number, sum(p) AS s FROM (SELECT team_number, points p FROM score_awards UNION ALL SELECT a.team_number, r.points FROM score_reversals r JOIN score_awards a ON a.id=r.award_id) x GROUP BY team_number`);
    for (const r of ledger.rows) expect(board1.find((t: any) => t.teamNumber === r.team_number).total).toBe(Number(r.s));
    await app2.close(); await db2.end();
  });

  it('공동 순위', async () => {
    const teams = (await req(ctx.app, admin, 'GET', '/api/admin/scores/board')).json().teams;
    for (const t of teams) expect(t.rank).toBe(1 + teams.filter((o: any) => o.total > t.total).length);
  });

  it('CSV 내보내기는 관리자만, BOM·수식주입 방지', async () => {
    await award(admin, { teamNumber: 1, categoryKey: 'cheer', points: 10, reason: '=HYPERLINK("x") 응원' });
    const r = await req(ctx.app, admin, 'GET', '/api/admin/scores/export.csv');
    expect(r.statusCode).toBe(200);
    expect(r.body.charCodeAt(0)).toBe(0xfeff);
    expect(r.body).toContain(`"'=HYPERLINK(""x"") 응원"`);
  });
});

describe('권한 해제 즉시 반영', () => {
  it('관리자 해제 후 기존 세션으로 관리자 API 불가', async () => {
    const [id] = await addParticipants(ctx.db, EV, [{ employeeId: 'M-9', name: '임시관리', team: 5, role: 'admin' }]);
    const s = await loginAs(ctx.app, '임시관리', 'M-9');
    expect((await req(ctx.app, s, 'GET', '/api/admin/scores/board')).statusCode).toBe(200);
    const r = await req(ctx.app, owner, 'POST', `/api/owner/participants/${id}/role`, { role: 'participant' });
    expect(r.statusCode).toBe(200);
    expect((await req(ctx.app, s, 'GET', '/api/admin/scores/board')).statusCode).toBe(403);
    const me = (await req(ctx.app, s, 'GET', '/api/me')).json();
    expect(me.isStaff).toBe(false);
  });
  it('자기 자신·마지막 owner 해제 금지', async () => {
    const meId = (await req(ctx.app, owner, 'GET', '/api/me')).json().id;
    expect((await req(ctx.app, owner, 'POST', `/api/owner/participants/${meId}/role`, { role: 'admin' })).statusCode).toBe(400);
  });
  it('loadSession은 매번 DB를 읽는다', async () => {
    const token = decodeURIComponent(part.cookie.split('=')[1]);
    const u1 = await loadSession(ctx.db, EV, token);
    await ctx.db.query(`UPDATE participants SET role='admin' WHERE id=$1`, [partId]);
    const u2 = await loadSession(ctx.db, EV, token);
    await ctx.db.query(`UPDATE participants SET role='participant' WHERE id=$1`, [partId]);
    expect(u1!.role).toBe('participant');
    expect(u2!.role).toBe('admin');
  });
});

describe('서비스 레벨 동시 취소 (직접 호출)', () => {
  it('20개 동시 취소 → reversal 1개', async () => {
    const actor = (await loadSession(ctx.db, EV, decodeURIComponent(admin.cookie.split('=')[1])))!;
    const { award: a } = await createAward(ctx.db, EV, actor, { teamNumber: 8, categoryKey: 'jumprope', points: 100, reason: '단체줄넘기 2위', idempotencyKey: key() });
    const results = await Promise.allSettled(Array.from({ length: 20 }, () =>
      cancelAward(ctx.db, EV, actor, ctx.config.cancelPasswordHash, a.id, { password: '1234', reason: '동시성 테스트', idempotencyKey: key() })));
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
    const n = await ctx.db.query(`SELECT count(*) AS n FROM score_reversals WHERE award_id=$1`, [a.id]);
    expect(Number(n.rows[0].n)).toBe(1);
  });
});
