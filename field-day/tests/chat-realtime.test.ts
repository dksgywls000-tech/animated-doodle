import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { addParticipants, createTestContext, key, loginAs, req, type Session, type TestCtx } from './helpers.js';

let ctx: TestCtx;
const EV = 'test-event';
let p3: Session, p3b: Session, p5: Session, admin: Session, owner: Session;
let p3bId: string, adminId: string;
let port = 0;

beforeAll(async () => {
  ctx = await createTestContext();
  const ids = await addParticipants(ctx.db, EV, [
    { employeeId: 'C-1', name: '삼조일', team: 3 },
    { employeeId: 'C-2', name: '삼조이', team: 3 },
    { employeeId: 'C-3', name: '오조일', team: 5 },
    { employeeId: 'C-A', name: '운영자', team: 1, role: 'admin' },
    { employeeId: 'C-O', name: '총괄', team: 2, role: 'owner' },
  ]);
  p3bId = ids[1]; adminId = ids[3];
  p3 = await loginAs(ctx.app, '삼조일', 'C-1');
  p3b = await loginAs(ctx.app, '삼조이', 'C-2');
  p5 = await loginAs(ctx.app, '오조일', 'C-3');
  admin = await loginAs(ctx.app, '운영자', 'C-A');
  owner = await loginAs(ctx.app, '총괄', 'C-O');
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  port = (ctx.app.server.address() as { port: number }).port;
});
afterAll(async () => { await ctx.close(); });

const send = (s: Session, channel: string, body: string, clientMsgId = key()) =>
  req(ctx.app, s, 'POST', `/api/chat/${channel}/messages`, { body, clientMsgId });

describe('채팅 권한', () => {
  it('자기 조 채팅만 읽고 쓰기, 다른 조 지정은 403', async () => {
    expect((await send(p3, 'team', '삼조 화이팅')).statusCode).toBe(200);
    expect((await send(p3, 'team:3', '명시적 3조')).statusCode).toBe(200);
    expect((await send(p3, 'team:5', '침입')).statusCode).toBe(403);
    expect((await req(ctx.app, p3, 'GET', '/api/chat/team:5/messages')).statusCode).toBe(403);
    const five = (await req(ctx.app, p5, 'GET', '/api/chat/team/messages')).json();
    expect(five.channel).toBe('team:5');
    expect(five.messages.some((m: any) => m.body?.includes('삼조'))).toBe(false);
    expect((await req(ctx.app, null, 'GET', '/api/chat/all/messages')).statusCode).toBe(401);
  });

  it('채팅 응답에 사번·명단이 포함되지 않는다', async () => {
    await send(p5, 'all', '안녕하세요');
    const body = (await req(ctx.app, p3, 'GET', '/api/chat/all/messages')).body;
    for (const id of ['C-1', 'C-2', 'C-3', 'C-A', 'C-O']) expect(body).not.toContain(id);
    expect(body).not.toMatch(/employee/i);
  });

  it('XSS 문자열은 텍스트 그대로 저장·반환(서버는 HTML을 만들지 않음)', async () => {
    const x = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const r = await send(p3, 'all', x);
    expect(r.json().message.body).toBe(x);
    expect(r.headers['content-type']).toContain('application/json');
  });

  it('빈 내용·500자 초과 거절', async () => {
    expect((await send(p3, 'all', '   ')).statusCode).toBe(400);
    expect((await send(p3, 'all', '가'.repeat(501))).statusCode).toBe(400);
    expect((await send(p3, 'all', '가'.repeat(500))).statusCode).toBe(200);
  });

  it('재전송(같은 clientMsgId)은 중복 생성 없음', async () => {
    const id = key();
    const rs = await Promise.all(Array.from({ length: 5 }, () => send(p5, 'all', '재전송 테스트', id)));
    expect(rs.every((r) => r.statusCode === 200)).toBe(true);
    const n = await ctx.db.query(`SELECT count(*) AS n FROM messages WHERE client_msg_id=$1`, [id]);
    expect(Number(n.rows[0].n)).toBe(1);
  });

  it('도배 제한', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await send(p3b, 'all', `도배 ${i}`)).statusCode);
    expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true);
    expect(codes[5]).toBe(429);
  });

  it('내 메시지 삭제는 표시 유지, 남의 메시지 삭제 불가, 관리자 숨김', async () => {
    const m = (await send(p5, 'all', '지울 메시지')).json().message;
    expect((await req(ctx.app, p3, 'DELETE', `/api/chat/messages/${m.id}`)).statusCode).toBe(403);
    const d = (await req(ctx.app, p5, 'DELETE', `/api/chat/messages/${m.id}`)).json().message;
    expect(d.state).toBe('deleted');
    expect(d.body).toBeNull();
    const m2 = (await send(p5, 'all', '부적절한 메시지')).json().message;
    expect((await req(ctx.app, p3, 'POST', `/api/chat/messages/${m2.id}/report`, { reason: '욕설' })).statusCode).toBe(200);
    expect((await req(ctx.app, p3, 'POST', `/api/admin/chat/messages/${m2.id}/hide`, {})).statusCode).toBe(403);
    expect((await req(ctx.app, admin, 'POST', `/api/admin/chat/messages/${m2.id}/hide`, {})).statusCode).toBe(200);
    const list = (await req(ctx.app, p3, 'GET', '/api/chat/all/messages')).json().messages;
    const hidden = list.find((x: any) => x.id === m2.id);
    expect(hidden.state).toBe('hidden');
    expect(hidden.body).toBeNull();
    const reports = (await req(ctx.app, admin, 'GET', '/api/admin/reports')).json().reports;
    expect(reports.length).toBeGreaterThan(0);
  });

  it('다른 조 메시지 신고 경로로도 열람 불가', async () => {
    const m = (await send(p5, 'team', '오조 비밀')).json().message;
    expect((await req(ctx.app, p3, 'POST', `/api/chat/messages/${m.id}/report`, {})).statusCode).toBe(404);
  });

  it('관리자 타 조 열람은 별도 경로 + 감사 기록', async () => {
    expect((await req(ctx.app, admin, 'GET', '/api/chat/team:5/messages')).statusCode).toBe(403);
    const r = await req(ctx.app, admin, 'GET', '/api/admin/chat/team/5');
    expect(r.statusCode).toBe(200);
    const a = await ctx.db.query(`SELECT 1 FROM audit_events WHERE action='admin_view_team_chat' AND actor_id=$1`, [adminId]);
    expect(a.rowCount).toBe(1);
  });

  it('미읽음 수와 읽음 처리', async () => {
    await send(p5, 'all', '새 소식');
    const u = (await req(ctx.app, p3, 'GET', '/api/chat/unread')).json();
    expect(u.all).toBeGreaterThan(0);
    await req(ctx.app, p3, 'POST', '/api/chat/all/read');
    expect((await req(ctx.app, p3, 'GET', '/api/chat/unread')).json().all).toBe(0);
  });

  it('페이지네이션', async () => {
    const first = (await req(ctx.app, p3, 'GET', '/api/chat/all/messages')).json();
    expect(Array.isArray(first.messages)).toBe(true);
    const bad = await req(ctx.app, p3, 'GET', '/api/chat/all/messages?before=garbage');
    expect(bad.statusCode).toBe(400);
  });
});

// ── WebSocket ──────────────────────────────────────
function connect(s: Session | null, origin = `http://127.0.0.1:${port}`): Promise<{ ws: WebSocket; events: any[]; waitFor: (pred: (e: any) => boolean, ms?: number) => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { ...(s ? { cookie: s.cookie } : {}), origin } });
    const events: any[] = [];
    const waiters: { pred: (e: any) => boolean; res: (e: any) => void }[] = [];
    ws.on('message', (raw) => {
      const e = JSON.parse(raw.toString());
      events.push(e);
      for (const w of [...waiters]) if (w.pred(e)) { waiters.splice(waiters.indexOf(w), 1); w.res(e); }
    });
    ws.on('unexpected-response', (_r, res) => reject(new Error('status ' + res.statusCode)));
    ws.on('error', reject);
    const waitFor = (pred: (e: any) => boolean, ms = 3000) => new Promise<any>((res, rej) => {
      const found = events.find(pred);
      if (found) return res(found);
      const t = setTimeout(() => rej(new Error('timeout')), ms);
      waiters.push({ pred, res: (e) => { clearTimeout(t); res(e); } });
    });
    ws.on('open', () => resolve({ ws, events, waitFor }));
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('실시간 채널', () => {
  it('비로그인·외부 Origin 연결 거절', async () => {
    await expect(connect(null)).rejects.toThrow();
    await expect(connect(p3, 'https://evil.example')).rejects.toThrow();
  });

  it('참가자는 admin·타 조 채널 구독 거절', async () => {
    const c = await connect(p3);
    c.ws.send(JSON.stringify({ type: 'subscribe', channels: ['chat:all', 'chat:team:3', 'chat:team:5', 'admin', 'public'] }));
    const sub = await c.waitFor((e) => e.type === 'subscribed');
    expect(sub.channels.sort()).toEqual(['chat:all', 'chat:team:3', 'public'].sort());
    expect(sub.denied.sort()).toEqual(['admin', 'chat:team:5']);
    c.ws.close();
  });

  it('참가자·관리자 두 세션: 점수 이벤트는 관리자에게만, 채팅은 해당 조에만', async () => {
    const part = await connect(p3);
    const other = await connect(p5);
    const adm = await connect(admin);
    part.ws.send(JSON.stringify({ type: 'subscribe', channels: ['chat:all', 'chat:team:3', 'public', 'admin'] }));
    other.ws.send(JSON.stringify({ type: 'subscribe', channels: ['chat:all', 'chat:team:5', 'public'] }));
    adm.ws.send(JSON.stringify({ type: 'subscribe', channels: ['chat:all', 'chat:team:1', 'public', 'admin'] }));
    await Promise.all([part, other, adm].map((c) => c.waitFor((e) => e.type === 'subscribed')));

    await req(ctx.app, admin, 'POST', '/api/admin/scores/awards', { teamNumber: 3, categoryKey: 'cheer', points: 100, reason: '응원 최고', idempotencyKey: key() });
    await adm.waitFor((e) => e.type === 'scores_changed');
    await send(p3, 'team', '실시간 삼조');
    await part.waitFor((e) => e.type === 'chat_message' && e.data.body === '실시간 삼조');
    await sleep(300);
    expect(part.events.some((e) => e.type === 'scores_changed')).toBe(false);
    expect(other.events.some((e) => e.type === 'scores_changed')).toBe(false);
    expect(other.events.some((e) => e.data?.body === '실시간 삼조')).toBe(false);
    expect(JSON.stringify(part.events)).not.toMatch(/points|total|rank/);
    [part, other, adm].forEach((c) => c.ws.close());
  });

  it('관리자 권한 해제 → 기존 admin 구독 즉시 해제, 이후 점수 이벤트 미수신', async () => {
    const [id] = await addParticipants(ctx.db, EV, [{ employeeId: 'C-T', name: '임시운영', team: 4, role: 'admin' }]);
    const s = await loginAs(ctx.app, '임시운영', 'C-T');
    const c = await connect(s);
    c.ws.send(JSON.stringify({ type: 'subscribe', channels: ['admin'] }));
    expect((await c.waitFor((e) => e.type === 'subscribed')).channels).toEqual(['admin']);
    await req(ctx.app, owner, 'POST', `/api/owner/participants/${id}/role`, { role: 'participant' });
    const revoked = await c.waitFor((e) => e.type === 'revoked');
    expect(revoked.channels).toEqual(['admin']);
    const before = c.events.length;
    await req(ctx.app, admin, 'POST', '/api/admin/scores/awards', { teamNumber: 1, categoryKey: 'cheer', points: 10, reason: '응원 테스트', idempotencyKey: key() });
    await sleep(300);
    expect(c.events.slice(before).some((e) => e.type === 'scores_changed')).toBe(false);
    c.ws.close();
  });

  it('DB에서 직접 권한을 바꿔도(신호 없이) 다음 전송 때 재검증되어 차단', async () => {
    const [id] = await addParticipants(ctx.db, EV, [{ employeeId: 'C-U', name: '직접변경', team: 4, role: 'admin' }]);
    const s = await loginAs(ctx.app, '직접변경', 'C-U');
    const c = await connect(s);
    c.ws.send(JSON.stringify({ type: 'subscribe', channels: ['admin'] }));
    await c.waitFor((e) => e.type === 'subscribed');
    await ctx.db.query(`UPDATE participants SET role='participant' WHERE id=$1`, [id]);
    await req(ctx.app, admin, 'POST', '/api/admin/scores/awards', { teamNumber: 2, categoryKey: 'cheer', points: 10, reason: '응원 재검증', idempotencyKey: key() });
    await c.waitFor((e) => e.type === 'revoked');
    expect(c.events.some((e) => e.type === 'scores_changed')).toBe(false);
    c.ws.close();
  });

  it('조 변경 후 이전 조 채팅 HTTP·실시간 접근 종료', async () => {
    const c = await connect(p3b);
    c.ws.send(JSON.stringify({ type: 'subscribe', channels: ['chat:team:3'] }));
    await c.waitFor((e) => e.type === 'subscribed');
    const r = await req(ctx.app, owner, 'POST', `/api/owner/participants/${p3bId}/team`, { teamNumber: 6, reason: '현장 인원 조정' });
    expect(r.statusCode).toBe(200);
    await c.waitFor((e) => e.type === 'revoked');
    await c.waitFor((e) => e.type === 'me_changed');
    expect((await req(ctx.app, p3b, 'GET', '/api/chat/team:3/messages')).statusCode).toBe(403);
    expect((await req(ctx.app, p3b, 'GET', '/api/chat/team/messages')).json().channel).toBe('team:6');
    const before = c.events.length;
    await send(p3, 'team', '이전 조 메시지');
    await sleep(300);
    expect(c.events.slice(before).some((e) => e.type === 'chat_message')).toBe(false);
    const audit = await ctx.db.query(`SELECT detail FROM audit_events WHERE action='team_change' AND target=$1`, [p3bId]);
    expect(audit.rows[0].detail).toMatchObject({ from: 3, to: 6, reason: '현장 인원 조정' });
    c.ws.close();
  });

  it('로그아웃하면 실시간 연결도 종료', async () => {
    const s = await loginAs(ctx.app, '오조일', 'C-3');
    const c = await connect(s);
    c.ws.send(JSON.stringify({ type: 'subscribe', channels: ['chat:all'] }));
    await c.waitFor((e) => e.type === 'subscribed');
    await req(ctx.app, s, 'POST', '/api/logout');
    await c.waitFor((e) => e.type === 'session_ended');
    await new Promise((r) => c.ws.once('close', r));
  });
});
