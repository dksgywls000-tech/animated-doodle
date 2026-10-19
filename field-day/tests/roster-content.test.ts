import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addParticipants, createTestContext, key, loginAs, req, type Session, type TestCtx } from './helpers.js';
import { parseRoster } from '../server/services/roster.js';
import { computeNowNext } from '../server/services/content.js';

let ctx: TestCtx;
const EV = 'test-event';
let owner: Session, admin: Session, part: Session;

beforeAll(async () => {
  ctx = await createTestContext();
  await addParticipants(ctx.db, EV, [
    { employeeId: 'OW-1', name: '총괄', team: 1, role: 'owner' },
    { employeeId: 'AD-1', name: '운영', team: 2, role: 'admin' },
    { employeeId: 'PA-1', name: '참가', team: 3 },
  ]);
  owner = await loginAs(ctx.app, '총괄', 'OW-1');
  admin = await loginAs(ctx.app, '운영', 'AD-1');
  part = await loginAs(ctx.app, '참가', 'PA-1');
});
afterAll(async () => { await ctx.close(); });

const csv = (rows: string[]) => ['employee_id,name,team_number,role,active', ...rows].join('\r\n');

describe('CSV 파싱', () => {
  it('BOM·CRLF·따옴표·앞자리 0·한글 헤더', () => {
    const { rows, errors } = parseRoster('﻿사번,이름,조,역할,활성\r\n"000777","김 영희",3조,참가자,Y\r\n');
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ employeeId: '000777', name: '김 영희', teamNumber: 3, role: 'participant', active: true });
  });
  it('검증 오류: 조 범위·역할·활성·빈값·중복', () => {
    const { errors } = parseRoster(csv(['X1,가,9,participant,true', 'X2,나,1,boss,true', 'X3,다,1,admin,maybe', ',라,1,,', 'X5,,1,,', 'X6,바,1,,', 'X6,사,2,,', 'x6,아,2,,']));
    const lines = errors.map((e) => e.line);
    expect(lines).toEqual([2, 3, 4, 5, 6, 8, 9]);
    expect(errors.find((e) => e.line === 8)!.reason).toContain('중복');
    expect(errors.find((e) => e.line === 9)!.reason).toContain('대소문자');
  });
  it('중복 이름은 허용', () => {
    expect(parseRoster(csv(['Y1,같은이름,1,,', 'Y2,같은이름,2,,'])).errors).toEqual([]);
  });
});

describe('명단 업로드 API', () => {
  it('owner만 가능', async () => {
    expect((await req(ctx.app, admin, 'POST', '/api/owner/roster/preview', { csv: csv(['N1,새사람,1,,']) })).statusCode).toBe(403);
  });

  it('preview → 오류 있으면 전체 반영 중단', async () => {
    const text = csv(['N1,새사람,1,,', 'N2,오류,0,,']);
    const p = (await req(ctx.app, owner, 'POST', '/api/owner/roster/preview', { csv: text })).json();
    expect(p.inserts).toBe(1);
    expect(p.errors).toHaveLength(1);
    const c = await req(ctx.app, owner, 'POST', '/api/owner/roster/commit', { csv: text });
    expect(c.statusCode).toBe(422);
    const n = await ctx.db.query(`SELECT 1 FROM participants WHERE employee_id='N1'`);
    expect(n.rowCount).toBe(0);
  });

  it('역할 변경은 별도 확인 필요, 확인 후 반영', async () => {
    const text = csv(['PA-1,참가,3,admin,true', 'N3,신규,4,,']);
    const c1 = await req(ctx.app, owner, 'POST', '/api/owner/roster/commit', { csv: text });
    expect(c1.statusCode).toBe(409);
    expect(c1.json().error.roleChanges).toHaveLength(1);
    const c2 = await req(ctx.app, owner, 'POST', '/api/owner/roster/commit', { csv: text, confirmRoleChanges: true });
    expect(c2.statusCode).toBe(200);
    expect((await req(ctx.app, part, 'GET', '/api/me')).json().isStaff).toBe(true);
    await req(ctx.app, owner, 'POST', '/api/owner/roster/commit', { csv: csv(['PA-1,참가,3,participant,true']), confirmRoleChanges: true });
    expect((await req(ctx.app, part, 'GET', '/api/me')).json().isStaff).toBe(false);
  });

  it('자신 강등·자신 비활성·마지막 owner 제거 금지', async () => {
    const r1 = (await req(ctx.app, owner, 'POST', '/api/owner/roster/preview', { csv: csv(['OW-1,총괄,1,admin,true']) })).json();
    expect(r1.errors.length).toBeGreaterThan(0);
    const r2 = (await req(ctx.app, owner, 'POST', '/api/owner/roster/preview', { csv: csv(['OW-1,총괄,1,owner,false']) })).json();
    expect(r2.errors.length).toBeGreaterThan(0);
  });

  it('체크인 후 조 변경은 업로드로 불가, 행운권은 재업로드로 유지', async () => {
    const before = (await req(ctx.app, part, 'GET', '/api/me')).json();
    const p = (await req(ctx.app, owner, 'POST', '/api/owner/roster/preview', { csv: csv(['PA-1,참가,5,participant,true']) })).json();
    expect(p.errors[0].reason).toContain('조 예외 변경');
    await req(ctx.app, owner, 'POST', '/api/owner/roster/commit', { csv: csv(['PA-1,참가,3,participant,true', 'N4,또신규,2,,']), confirmRoleChanges: true });
    const after = (await req(ctx.app, part, 'GET', '/api/me')).json();
    expect(after.ticketNumber).toBe(before.ticketNumber);
  });

  it('업로드로 비활성화하면 기존 세션도 종료', async () => {
    await addParticipants(ctx.db, EV, [{ employeeId: 'GO-1', name: '나갈사람', team: 7 }]);
    const s = await loginAs(ctx.app, '나갈사람', 'GO-1');
    await req(ctx.app, owner, 'POST', '/api/owner/roster/commit', { csv: csv(['GO-1,나갈사람,7,participant,false']) });
    expect((await req(ctx.app, s, 'GET', '/api/me')).statusCode).toBe(401);
  });

  it('체크인 현황: admin은 사번 마스킹, owner는 전체', async () => {
    const a = (await req(ctx.app, admin, 'GET', '/api/admin/checkins')).json();
    const o = (await req(ctx.app, owner, 'GET', '/api/owner/export/checkins.csv'));
    expect(a.people.find((x: any) => x.name === '참가').employeeId).not.toBe('PA-1');
    expect(o.body).toContain('PA-1');
    expect(a.teams).toHaveLength(8);
  });
});

describe('공지·일정·도움 요청', () => {
  it('공지 작성은 관리자만, 참가자는 읽음 표시', async () => {
    expect((await req(ctx.app, part, 'POST', '/api/admin/announcements', { title: 'x' })).statusCode).toBe(403);
    const c = await req(ctx.app, admin, 'POST', '/api/admin/announcements', { title: '집합 안내', body: '13시 조별 정렬', important: true });
    expect(c.statusCode).toBe(200);
    const list = (await req(ctx.app, part, 'GET', '/api/announcements')).json().announcements;
    expect(list[0]).toMatchObject({ title: '집합 안내', important: true, read: false });
    await req(ctx.app, part, 'POST', `/api/announcements/${list[0].id}/read`);
    expect((await req(ctx.app, part, 'GET', '/api/announcements')).json().announcements[0].read).toBe(true);
  });

  it('일정은 초안 상태로 시작, 시간 확인 중 항목 존재, 원문 배점 미노출', async () => {
    const s = (await req(ctx.app, part, 'GET', '/api/schedule')).json();
    expect(s.event.schedulePublished).toBe(false);
    expect(s.items.some((i: any) => i.status === 'time_tbd' && i.title === '공 튕기기')).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/200점|100점|50점|배점/);
    expect(s.event.parking).toBeNull();
    expect(s.event.returnBus).toBeNull();
    const g = (await req(ctx.app, part, 'GET', '/api/games')).body;
    expect(g).not.toMatch(/200점|100점|50점|배점|점수/);
  });

  it('관리자가 진행 중으로 지정하면 수동 기준이 현재 항목', async () => {
    const items = (await req(ctx.app, admin, 'GET', '/api/admin/schedule')).json().items;
    const jr = items.find((i: any) => i.gameKey === 'jumprope');
    const r = await req(ctx.app, admin, 'PATCH', `/api/admin/schedule/${jr.id}`, { ...jr, status: 'live', delayNote: '5분 지연' });
    expect(r.statusCode).toBe(200);
    const h = (await req(ctx.app, part, 'GET', '/api/home')).json();
    expect(h.nowNext.basis).toBe('manual');
    expect(h.current[0].id).toBe(jr.id);
    expect(h.next.sortOrder).toBeGreaterThan(jr.sortOrder);
  });

  it('주차 안내는 공개 체크 후에만 노출', async () => {
    await req(ctx.app, admin, 'PATCH', '/api/admin/event', { parkingPublished: true });
    expect((await req(ctx.app, part, 'GET', '/api/schedule')).json().event.parking).toContain('3시간');
  });

  it('도움 요청: 본인 것만 조회, 관리자 전체 조회, 재전송 중복 없음', async () => {
    const id = key();
    await req(ctx.app, part, 'POST', '/api/help', { kind: 'route', body: '화장실 위치', clientReqId: id });
    await req(ctx.app, part, 'POST', '/api/help', { kind: 'route', body: '화장실 위치', clientReqId: id });
    expect((await req(ctx.app, part, 'GET', '/api/help')).json().requests).toHaveLength(1);
    expect((await req(ctx.app, admin, 'GET', '/api/help')).json().requests).toHaveLength(0);
    const all = (await req(ctx.app, admin, 'GET', '/api/admin/help')).json().requests;
    expect(all).toHaveLength(1);
    await req(ctx.app, admin, 'PATCH', `/api/admin/help/${all[0].id}`, { status: 'in_progress' });
    expect((await req(ctx.app, part, 'GET', '/api/help')).json().requests[0].status).toBe('in_progress');
  });

  it('초기 설정 체크리스트에 원문 충돌 항목 포함', async () => {
    const items = (await req(ctx.app, admin, 'GET', '/api/admin-setup-none')).statusCode;
    expect(items).toBe(404);
    const c = (await req(ctx.app, admin, 'GET', '/api/admin/setup-checklist')).json().items;
    expect(c.map((i: any) => i.key)).toEqual(expect.arrayContaining(['overlap', 'tube_third', 'cancel_password']));
  });

  it('오류 응답에 DB 원문 오류가 노출되지 않는다', async () => {
    const r = await req(ctx.app, admin, 'PATCH', '/api/admin/schedule/00000000-0000-0000-0000-000000000000', { title: 'x', status: 'live' });
    expect(r.statusCode).toBe(404);
    const bad = await ctx.app.inject({ method: 'POST', url: '/api/login', headers: { 'content-type': 'application/json' }, payload: '{bad json' });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).not.toMatch(/Unexpected|SyntaxError|postgres|relation/i);
  });
});

describe('현재/다음 계산', () => {
  const items = [
    { id: 'a', sortOrder: 10, startTime: '13:00', endTime: '13:30', status: 'scheduled' },
    { id: 'b', sortOrder: 20, startTime: '13:30', endTime: '14:00', status: 'scheduled' },
    { id: 'c', sortOrder: 30, startTime: '14:00', endTime: '14:30', status: 'time_tbd' },
  ].map((i) => ({ ...i, title: i.id, note: '', kind: 'general', gameKey: null, delayNote: '', public: true, updatedAt: '' }));
  it('행사 당일 시각 기준 추정', () => {
    const r = computeNowNext(items, '2026-10-21', new Date('2026-10-21T04:40:00Z')); // 13:40 KST
    expect(r.currentIds).toEqual(['b']);
    expect(r.nextId).toBe('c');
    expect(r.basis).toBe('time');
  });
  it('행사 전에는 현재 없음·첫 항목이 다음', () => {
    const r = computeNowNext(items, '2026-10-21', new Date('2026-10-18T04:40:00Z'));
    expect(r.currentIds).toEqual([]);
    expect(r.nextId).toBe('a');
    expect(r.beforeEvent).toBe(true);
  });
  it('행사 후에도 잠기지 않고 일정 조회 가능', () => {
    const r = computeNowNext(items, '2026-10-21', new Date('2026-11-01T04:40:00Z'));
    expect(r.currentIds).toEqual([]);
    expect(r.nextId).toBeNull();
  });
});
