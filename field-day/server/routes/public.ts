import type { FastifyInstance } from 'fastify';
import { COOKIE_NAME, requireUser, type AppDeps } from '../app.js';
import { login, logout, isStaff } from '../services/auth.js';
import { AppError, maskEmployeeId } from '../util.js';
import { computeNowNext, getAnnouncements, getEvent, getGames, getSchedule, publicEventInfo, toDateStr } from '../services/content.js';

export function registerPublicRoutes(api: FastifyInstance, { config, db, hub }: AppDeps) {
  api.get('/health', async () => ({ ok: true }));

  // 로그인 전 화면용 — 개인정보 없음
  api.get('/public/event', async () => {
    const ev = await getEvent(db, config.eventId);
    if (!ev) throw new AppError(503, 'not_initialized', '행사 정보가 아직 준비되지 않았습니다. 운영진에게 문의해 주세요.');
    return { title: ev.title, date: toDateStr(ev.event_date), venue: ev.venue, demo: config.mode === 'demo' };
  });

  api.post('/login', async (req, reply) => {
    const body = (req.body ?? {}) as { name?: unknown; employeeId?: unknown };
    const result = await login(db, config, body, req.ip);
    reply.setCookie(COOKIE_NAME, result.token, {
      httpOnly: true, secure: config.secureCookies, sameSite: 'lax', path: '/', maxAge: config.sessionTtlHours * 3600,
    });
    return { ok: true, isNewCheckin: result.isNewCheckin, csrfToken: result.user.csrfToken };
  });

  api.post('/logout', async (req, reply) => {
    if (req.user) {
      await logout(db, req.user.sessionHash);
      await hub.revalidate(req.user.participantId); // 이 세션의 실시간 연결 종료
    }
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  /**
   * 본인 정보. 점수·순위·기록 필드는 존재하지 않는다.
   */
  api.get('/me', async (req) => {
    const u = requireUser(req);
    const [ci, team] = await Promise.all([
      db.query(`SELECT ticket_number, checked_in_at FROM checkins WHERE event_id=$1 AND participant_id=$2`, [config.eventId, u.participantId]),
      db.query(`SELECT display_name, seat_note FROM teams WHERE event_id=$1 AND team_number=$2`, [config.eventId, u.teamNumber]),
    ]);
    return {
      id: u.participantId,
      name: u.name,
      employeeIdMasked: maskEmployeeId(u.employeeId),
      teamNumber: u.teamNumber,
      teamName: team.rows[0]?.display_name ?? `${u.teamNumber}조`,
      seatNote: team.rows[0]?.seat_note ?? '',
      ticketNumber: ci.rows[0]?.ticket_number ?? null,
      checkedInAt: ci.rows[0]?.checked_in_at ?? null,
      isStaff: isStaff(u.role),
      role: u.role,
      csrfToken: u.csrfToken,
      demo: config.mode === 'demo',
    };
  });

  api.get('/home', async (req) => {
    const u = requireUser(req);
    const ev = await getEvent(db, config.eventId);
    const [items, ann] = await Promise.all([getSchedule(db, config.eventId), getAnnouncements(db, config.eventId, u.participantId)]);
    const nn = computeNowNext(items, toDateStr(ev.event_date));
    return { event: publicEventInfo(ev), nowNext: nn, current: items.filter((i) => nn.currentIds.includes(i.id)), next: items.find((i) => i.id === nn.nextId) ?? null, announcements: ann.slice(0, 5) };
  });

  api.get('/schedule', async (req) => {
    requireUser(req);
    const ev = await getEvent(db, config.eventId);
    const items = await getSchedule(db, config.eventId);
    const lastUpdated = items.reduce((m, i) => (i.updatedAt > m ? i.updatedAt : m), ev.updated_at as unknown as string);
    return { event: publicEventInfo(ev), items, nowNext: computeNowNext(items, toDateStr(ev.event_date)), lastUpdated };
  });

  api.get('/games', async (req) => {
    requireUser(req);
    return { games: await getGames(db, config.eventId) };
  });

  api.get('/announcements', async (req) => {
    const u = requireUser(req);
    return { announcements: await getAnnouncements(db, config.eventId, u.participantId) };
  });

  api.post<{ Params: { id: string } }>('/announcements/:id/read', async (req) => {
    const u = requireUser(req);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw new AppError(404, 'not_found', '공지를 찾을 수 없습니다.');
    await db.query(
      `INSERT INTO announcement_reads (announcement_id, participant_id)
       SELECT id, $2 FROM announcements WHERE id=$1 AND event_id=$3 AND published ON CONFLICT DO NOTHING`,
      [req.params.id, u.participantId, config.eventId],
    );
    return { ok: true };
  });

  // ── 도움 요청 ──
  api.get('/help', async (req) => {
    const u = requireUser(req);
    const { rows } = await db.query(
      `SELECT id, kind, body, status, created_at, updated_at FROM help_requests WHERE requester_id=$1 ORDER BY created_at DESC LIMIT 20`,
      [u.participantId],
    );
    return { requests: rows.map((r) => ({ id: r.id, kind: r.kind, body: r.body, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at })) };
  });

  api.post('/help', async (req) => {
    const u = requireUser(req);
    const b = (req.body ?? {}) as { kind?: unknown; body?: unknown; clientReqId?: unknown };
    if (b.kind !== 'route' && b.kind !== 'supplies' && b.kind !== 'other') throw new AppError(400, 'invalid_kind', '요청 종류를 선택해 주세요.');
    const text = typeof b.body === 'string' ? b.body.trim() : '';
    if (text.length > 300) throw new AppError(400, 'too_long', '내용은 300자까지 입력할 수 있습니다.');
    if (b.kind === 'other' && text.length < 2) throw new AppError(400, 'body_required', '어떤 도움이 필요한지 적어 주세요.');
    if (typeof b.clientReqId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(b.clientReqId)) throw new AppError(400, 'invalid_client_id', '다시 시도해 주세요.');
    const open = await db.query(`SELECT count(*) AS n FROM help_requests WHERE requester_id=$1 AND status<>'done'`, [u.participantId]);
    const prior = await db.query(`SELECT id FROM help_requests WHERE requester_id=$1 AND client_req_id=$2`, [u.participantId, b.clientReqId]);
    if (!prior.rows[0] && Number(open.rows[0].n) >= 3) throw new AppError(429, 'too_many_open', '처리 중인 요청이 3개 있습니다. 급하면 운영지원 부스로 직접 와 주세요.');
    const { rows } = await db.query(
      `INSERT INTO help_requests (event_id, requester_id, kind, body, client_req_id) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (requester_id, client_req_id) DO UPDATE SET client_req_id=EXCLUDED.client_req_id
       RETURNING id, kind, body, status, created_at, (xmax = 0) AS inserted`,
      [config.eventId, u.participantId, b.kind, text, b.clientReqId],
    );
    if (rows[0].inserted) void hub.publish({ channel: 'admin', type: 'help_changed' });
    return { request: { id: rows[0].id, kind: rows[0].kind, body: rows[0].body, status: rows[0].status, createdAt: rows[0].created_at } };
  });
}
