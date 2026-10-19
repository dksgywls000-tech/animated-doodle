import type { FastifyInstance } from 'fastify';
import { requireAdmin, sendCsv, type AppDeps } from '../app.js';
import { cancelAward, createAward, getBoard, getCategories, getLog, type LogFilter } from '../services/scores.js';
import { getAnnouncements, getEvent, getGames, getSchedule } from '../services/content.js';
import { hideMessage, listMessages } from '../services/chat.js';
import { AppError, formatSeoul, maskEmployeeId, toCsv } from '../util.js';

const UUID = /^[0-9a-f-]{36}$/i;
const str = (v: unknown, max: number, field: string, min = 0): string => {
  const s = typeof v === 'string' ? v.normalize('NFC').trim() : '';
  if (s.length < min || s.length > max) throw new AppError(400, 'invalid_' + field, `${field} 값을 확인해 주세요. (${min}~${max}자)`);
  return s;
};
const timeOrNull = (v: unknown): string | null => {
  if (v === null || v === '' || v === undefined) return null;
  if (typeof v !== 'string' || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v)) throw new AppError(400, 'invalid_time', '시각은 HH:MM 형식으로 입력해 주세요.');
  return v;
};

function parseLogFilter(q: Record<string, string | undefined>): LogFilter {
  const team = q.team ? Number(q.team) : undefined;
  return {
    team: team && team >= 1 && team <= 8 ? team : undefined,
    category: q.category || undefined,
    actor: q.actor && UUID.test(q.actor) ? q.actor : undefined,
    status: q.status === 'active' || q.status === 'cancelled' ? q.status : undefined,
    limit: q.limit ? Number(q.limit) : undefined,
    offset: q.offset ? Number(q.offset) : undefined,
  };
}

export function registerAdminRoutes(api: FastifyInstance, { config, db, hub }: AppDeps) {
  const ev = config.eventId;
  const publicChanged = (what: string) => hub.publish({ channel: 'public', type: 'public_changed', data: { what } });

  // ── 점수 ──
  api.get('/admin/scores/categories', async (req) => { requireAdmin(req); return { categories: await getCategories(db, ev) }; });

  api.get('/admin/scores/board', async (req) => {
    requireAdmin(req);
    return { teams: await getBoard(db, ev), generatedAt: new Date().toISOString() };
  });

  api.get('/admin/scores/log', async (req) => {
    requireAdmin(req);
    const filter = parseLogFilter(req.query as Record<string, string>);
    const actors = await db.query(
      `SELECT DISTINCT actor_id AS id, actor_name AS name FROM score_awards WHERE event_id=$1
       UNION SELECT DISTINCT actor_id, actor_name FROM score_reversals WHERE event_id=$1`,
      [ev],
    );
    return { entries: await getLog(db, ev, filter), actors: actors.rows };
  });

  api.post('/admin/scores/awards', async (req) => {
    const u = requireAdmin(req);
    const result = await createAward(db, ev, u, (req.body ?? {}) as never);
    if (!result.replay) await hub.publish({ channel: 'admin', type: 'scores_changed' });
    return { award: { id: result.award.id, teamNumber: result.award.team_number, points: result.award.points, reason: result.award.reason, createdAt: result.award.created_at }, replay: result.replay, teams: await getBoard(db, ev) };
  });

  api.post<{ Params: { id: string } }>('/admin/scores/awards/:id/cancel', async (req) => {
    const u = requireAdmin(req);
    const result = await cancelAward(db, ev, u, config.cancelPasswordHash, req.params.id, (req.body ?? {}) as never);
    if (!result.replay) await hub.publish({ channel: 'admin', type: 'scores_changed' });
    return { reversal: { id: result.reversal.id, awardId: result.reversal.award_id, points: result.reversal.points, createdAt: result.reversal.created_at }, replay: result.replay, teams: await getBoard(db, ev) };
  });

  api.get('/admin/scores/export.csv', async (req, reply) => {
    const u = requireAdmin(req);
    const rows = await getLog(db, ev, { ...parseLogFilter(req.query as Record<string, string>), limit: 1000 });
    await db.query(`INSERT INTO audit_events (event_id, actor_id, actor_name, action) VALUES ($1,$2,$3,'export_scores')`, [ev, u.participantId, u.name]);
    const csv = toCsv(
      ['기록ID', '부여일시(KST)', '조', '종목', '세부유형', '점수', '사유', '부여자', '상태', '취소일시(KST)', '취소자', '취소사유', '상쇄점수'],
      rows.map((r) => [r.id, formatSeoul(r.createdAt), `${r.teamNumber}조`, r.categoryLabel, r.subtypeLabel ?? '', r.points, r.reason, r.actorName,
        r.status === 'cancelled' ? '취소' : '유효', r.reversal ? formatSeoul(r.reversal.createdAt) : '', r.reversal?.actorName ?? '', r.reversal?.reason ?? '', r.reversal?.points ?? '']),
    );
    return sendCsv(reply, 'score-log.csv', csv);
  });

  // ── 체크인 현황 ── (점수판의 요약도 같은 데이터)
  api.get('/admin/checkins/summary', async (_req, reply) => reply.redirect('/api/admin/checkins'));
  api.get('/admin/checkins', async (req) => {
    const u = requireAdmin(req);
    const { rows } = await db.query(
      `SELECT p.id, p.name, p.employee_id, p.team_number, p.role, p.active, c.ticket_number, c.checked_in_at
       FROM participants p LEFT JOIN checkins c ON c.participant_id=p.id AND c.event_id=p.event_id
       WHERE p.event_id=$1 ORDER BY p.team_number, p.name`,
      [ev],
    );
    const teams = Array.from({ length: 8 }, (_, i) => {
      const t = rows.filter((r) => r.team_number === i + 1 && r.active);
      return { teamNumber: i + 1, total: t.length, checkedIn: t.filter((r) => r.checked_in_at).length };
    });
    const owner = u.role === 'owner';
    return {
      teams,
      total: rows.filter((r) => r.active).length,
      checkedIn: rows.filter((r) => r.active && r.checked_in_at).length,
      people: rows.map((r) => ({
        id: r.id, name: r.name, employeeId: owner ? r.employee_id : maskEmployeeId(r.employee_id),
        teamNumber: r.team_number, role: r.role, active: r.active, ticketNumber: r.ticket_number, checkedInAt: r.checked_in_at,
      })),
    };
  });

  // ── 행운권 번호 조회 ──
  api.get<{ Params: { number: string } }>('/admin/tickets/:number', async (req) => {
    const u = requireAdmin(req);
    const n = Number(req.params.number);
    if (!Number.isInteger(n) || n < 1 || n > 100000) throw new AppError(400, 'invalid_ticket', '행운권 번호를 숫자로 입력해 주세요.');
    const { rows } = await db.query(
      `SELECT c.ticket_number, c.checkin_sequence, c.checked_in_at, p.id, p.name, p.employee_id, p.team_number, p.role, p.active
       FROM checkins c JOIN participants p ON p.id=c.participant_id WHERE c.event_id=$1 AND c.ticket_number=$2`,
      [ev, n],
    );
    const issued = await db.query(`SELECT count(*) AS n FROM checkins WHERE event_id=$1`, [ev]);
    await db.query(`INSERT INTO audit_events (event_id, actor_id, actor_name, action, target) VALUES ($1,$2,$3,'ticket_lookup',$4)`, [ev, u.participantId, u.name, String(n)]);
    const r = rows[0];
    return {
      issued: Number(issued.rows[0].n),
      ticket: r ? {
        ticketNumber: r.ticket_number, name: r.name, teamNumber: r.team_number, role: r.role, active: r.active, checkedInAt: r.checked_in_at,
        employeeId: u.role === 'owner' ? r.employee_id : maskEmployeeId(r.employee_id),
      } : null,
    };
  });

  // ── 공지 ──
  api.get('/admin/announcements', async (req) => { const u = requireAdmin(req); return { announcements: await getAnnouncements(db, ev, u.participantId, true) }; });

  api.post('/admin/announcements', async (req) => {
    const u = requireAdmin(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const { rows } = await db.query(
      `INSERT INTO announcements (event_id, title, body, important, published, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [ev, str(b.title, 80, 'title', 1), str(b.body, 1000, 'body'), b.important === true, b.published !== false, u.participantId],
    );
    await publicChanged('announcements');
    return { id: rows[0].id };
  });

  api.patch<{ Params: { id: string } }>('/admin/announcements/:id', async (req) => {
    requireAdmin(req);
    if (!UUID.test(req.params.id)) throw new AppError(404, 'not_found', '공지를 찾을 수 없습니다.');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const { rowCount } = await db.query(
      `UPDATE announcements SET title=$3, body=$4, important=$5, published=$6, updated_at=now() WHERE id=$1 AND event_id=$2`,
      [req.params.id, ev, str(b.title, 80, 'title', 1), str(b.body, 1000, 'body'), b.important === true, b.published !== false],
    );
    if (!rowCount) throw new AppError(404, 'not_found', '공지를 찾을 수 없습니다.');
    await publicChanged('announcements');
    return { ok: true };
  });

  // ── 일정 ──
  api.get('/admin/schedule', async (req) => { requireAdmin(req); return { items: await getSchedule(db, ev, true) }; });

  api.patch<{ Params: { id: string } }>('/admin/schedule/:id', async (req) => {
    const u = requireAdmin(req);
    if (!UUID.test(req.params.id)) throw new AppError(404, 'not_found', '일정을 찾을 수 없습니다.');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const status = b.status;
    if (!['scheduled', 'time_tbd', 'live', 'done', 'delayed'].includes(status as string)) throw new AppError(400, 'invalid_status', '진행 상태를 선택해 주세요.');
    const { rowCount } = await db.query(
      `UPDATE schedule_items SET title=$3, note=$4, start_time=$5, end_time=$6, status=$7, delay_note=$8, public=$9, updated_at=now()
       WHERE id=$1 AND event_id=$2`,
      [req.params.id, ev, str(b.title, 60, 'title', 1), str(b.note, 200, 'note'), timeOrNull(b.startTime), timeOrNull(b.endTime),
        status, str(b.delayNote, 120, 'delayNote'), b.public !== false],
    );
    if (!rowCount) throw new AppError(404, 'not_found', '일정을 찾을 수 없습니다.');
    await db.query(`INSERT INTO audit_events (event_id, actor_id, actor_name, action, target, detail) VALUES ($1,$2,$3,'schedule_update',$4,$5)`,
      [ev, u.participantId, u.name, req.params.id, JSON.stringify({ status })]);
    await publicChanged('schedule');
    return { ok: true };
  });

  api.post('/admin/schedule', async (req) => {
    requireAdmin(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const max = await db.query(`SELECT COALESCE(max(sort_order),0) AS m FROM schedule_items WHERE event_id=$1`, [ev]);
    const after = typeof b.afterSortOrder === 'number' ? b.afterSortOrder + 5 : Number(max.rows[0].m) + 10;
    const { rows } = await db.query(
      `INSERT INTO schedule_items (event_id, sort_order, start_time, end_time, title, note, kind, status) VALUES ($1,$2,$3,$4,$5,$6,'general',$7) RETURNING id`,
      [ev, after, timeOrNull(b.startTime), timeOrNull(b.endTime), str(b.title, 60, 'title', 1), str(b.note, 200, 'note'), b.startTime ? 'scheduled' : 'time_tbd'],
    );
    await publicChanged('schedule');
    return { id: rows[0].id };
  });

  // ── 경기 설명 ──
  api.get('/admin/games', async (req) => { requireAdmin(req); return { games: await getGames(db, ev, true) }; });

  api.patch<{ Params: { key: string } }>('/admin/games/:key', async (req) => {
    requireAdmin(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const { rowCount } = await db.query(
      `UPDATE game_info SET players=$3, summary=$4, how_to=$5, bracket_note=$6, pending_note=$7, published=$8, updated_at=now() WHERE event_id=$1 AND key=$2`,
      [ev, req.params.key, str(b.players, 100, 'players'), str(b.summary, 300, 'summary'), str(b.howTo, 1000, 'howTo'),
        str(b.bracketNote, 200, 'bracketNote'), str(b.pendingNote, 200, 'pendingNote'), b.published !== false],
    );
    if (!rowCount) throw new AppError(404, 'not_found', '경기를 찾을 수 없습니다.');
    await publicChanged('games');
    return { ok: true };
  });

  // ── 행사 공개 안내(진행 상태·주차·귀가 버스·일정 확정) ──
  api.get('/admin/event', async (req) => {
    requireAdmin(req);
    const e = await getEvent(db, ev);
    return {
      schedulePublished: e.schedule_published, parkingPublished: e.parking_published, parkingNote: e.parking_note,
      returnBusPublished: e.return_bus_published, returnBusNote: e.return_bus_note, departureNote: e.departure_note,
      statusNote: e.status_note, statusNoteUpdatedAt: e.status_note_updated_at,
    };
  });

  api.patch('/admin/event', async (req) => {
    const u = requireAdmin(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const e = await getEvent(db, ev);
    const statusNote = b.statusNote !== undefined ? str(b.statusNote, 140, 'statusNote') : e.status_note;
    await db.query(
      `UPDATE events SET schedule_published=$2, parking_published=$3, parking_note=$4, return_bus_published=$5, return_bus_note=$6,
         departure_note=$7, status_note=$8, status_note_updated_at = CASE WHEN status_note IS DISTINCT FROM $8 THEN now() ELSE status_note_updated_at END,
         updated_at=now() WHERE id=$1`,
      [ev,
        typeof b.schedulePublished === 'boolean' ? b.schedulePublished : e.schedule_published,
        typeof b.parkingPublished === 'boolean' ? b.parkingPublished : e.parking_published,
        b.parkingNote !== undefined ? str(b.parkingNote, 300, 'parkingNote') : e.parking_note,
        typeof b.returnBusPublished === 'boolean' ? b.returnBusPublished : e.return_bus_published,
        b.returnBusNote !== undefined ? str(b.returnBusNote, 300, 'returnBusNote') : e.return_bus_note,
        b.departureNote !== undefined ? str(b.departureNote, 300, 'departureNote') : e.departure_note,
        statusNote],
    );
    await db.query(`INSERT INTO audit_events (event_id, actor_id, actor_name, action, detail) VALUES ($1,$2,$3,'event_info_update',$4)`,
      [ev, u.participantId, u.name, JSON.stringify(Object.keys(b))]);
    await publicChanged('event');
    return { ok: true };
  });

  // ── 도움 요청 ──
  api.get('/admin/help', async (req) => {
    requireAdmin(req);
    const { rows } = await db.query(
      `SELECT h.id, h.kind, h.body, h.status, h.created_at, h.updated_at, p.name, p.team_number
       FROM help_requests h JOIN participants p ON p.id=h.requester_id WHERE h.event_id=$1
       ORDER BY (h.status='done'), h.created_at DESC LIMIT 200`,
      [ev],
    );
    return { requests: rows.map((r) => ({ id: r.id, kind: r.kind, body: r.body, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at, name: r.name, teamNumber: r.team_number })) };
  });

  api.patch<{ Params: { id: string } }>('/admin/help/:id', async (req) => {
    const u = requireAdmin(req);
    const status = (req.body as { status?: string } | undefined)?.status;
    if (!UUID.test(req.params.id) || !['open', 'in_progress', 'done'].includes(status ?? '')) throw new AppError(400, 'invalid', '상태 값을 확인해 주세요.');
    await db.query(`UPDATE help_requests SET status=$3, handled_by=$4, updated_at=now() WHERE id=$1 AND event_id=$2`, [req.params.id, ev, status, u.participantId]);
    await hub.publish({ channel: 'admin', type: 'help_changed' });
    return { ok: true };
  });

  // ── 채팅 신고·숨김 ──
  api.get('/admin/reports', async (req) => {
    requireAdmin(req);
    const { rows } = await db.query(
      `SELECT r.id, r.reason, r.status, r.created_at, m.id AS message_id, m.channel, m.body, m.sender_name, m.sender_team, m.hidden_at, m.deleted_at,
              rp.name AS reporter_name
       FROM message_reports r JOIN messages m ON m.id=r.message_id JOIN participants rp ON rp.id=r.reporter_id
       WHERE m.event_id=$1 ORDER BY (r.status<>'open'), r.created_at DESC LIMIT 200`,
      [ev],
    );
    return { reports: rows.map((r) => ({ id: r.id, reason: r.reason, status: r.status, createdAt: r.created_at, messageId: r.message_id, channel: r.channel, body: r.body, senderName: r.sender_name, senderTeam: r.sender_team, hidden: !!r.hidden_at, deleted: !!r.deleted_at, reporterName: r.reporter_name })) };
  });

  api.patch<{ Params: { id: string } }>('/admin/reports/:id', async (req) => {
    const u = requireAdmin(req);
    const status = (req.body as { status?: string } | undefined)?.status;
    if (!UUID.test(req.params.id) || !['open', 'resolved', 'dismissed'].includes(status ?? '')) throw new AppError(400, 'invalid', '상태 값을 확인해 주세요.');
    await db.query(`UPDATE message_reports SET status=$2, handled_by=$3, handled_at=now() WHERE id=$1`, [req.params.id, status, u.participantId]);
    await hub.publish({ channel: 'admin', type: 'reports_changed' });
    return { ok: true };
  });

  api.post<{ Params: { id: string } }>('/admin/chat/messages/:id/hide', async (req) => {
    const u = requireAdmin(req);
    if (!UUID.test(req.params.id)) throw new AppError(404, 'not_found', '메시지를 찾을 수 없습니다.');
    const hidden = (req.body as { hidden?: boolean } | undefined)?.hidden !== false;
    const msg = await hideMessage(db, ev, u, req.params.id, hidden);
    await db.query(`INSERT INTO audit_events (event_id, actor_id, actor_name, action, target) VALUES ($1,$2,$3,$4,$5)`,
      [ev, u.participantId, u.name, hidden ? 'chat_hide' : 'chat_unhide', req.params.id]);
    await hub.publish({ channel: msg.channel === 'all' ? 'chat:all' : `chat:${msg.channel}`, type: 'chat_update', data: msg });
    return { message: msg };
  });

  // 타 조 채팅 열람 — 명시적 관리자 화면에서만, 감사 기록
  api.get<{ Params: { team: string }; Querystring: { before?: string } }>('/admin/chat/team/:team', async (req) => {
    const u = requireAdmin(req);
    const team = Number(req.params.team);
    if (!Number.isInteger(team) || team < 1 || team > 8) throw new AppError(400, 'invalid_team', '1~8조 중에서 선택해 주세요.');
    await db.query(`INSERT INTO audit_events (event_id, actor_id, actor_name, action, target) VALUES ($1,$2,$3,'admin_view_team_chat',$4)`,
      [ev, u.participantId, u.name, `team:${team}`]);
    return { channel: `team:${team}`, ...(await listMessages(db, ev, `team:${team}`, u.participantId, req.query.before)) };
  });

  // ── 초기 설정 체크리스트 ──
  api.get('/admin/setup-checklist', async (req) => {
    requireAdmin(req);
    const e = await getEvent(db, ev);
    const counts = await db.query(
      `SELECT (SELECT count(*) FROM participants WHERE event_id=$1 AND active) AS roster,
              (SELECT count(*) FROM participants WHERE event_id=$1 AND active AND role IN ('admin','owner')) AS staff,
              (SELECT count(*) FROM schedule_items WHERE event_id=$1 AND public AND status='time_tbd') AS tbd`,
      [ev],
    );
    const c = counts.rows[0];
    const games = await getGames(db, ev, true);
    return {
      items: [
        { key: 'roster', label: '실제 참가자 명단 업로드', done: Number(c.roster) > Number(c.staff), detail: `활성 ${c.roster}명 (운영진 ${c.staff}명)` },
        { key: 'cancel_password', label: '점수 취소 비밀번호 운영값 설정', done: !config.cancelPasswordIsDefault, detail: config.cancelPasswordIsDefault ? '기본값 사용 중 — 서버 환경변수로 변경 권장' : '서버 환경변수 설정됨' },
        { key: 'schedule', label: '최종 일정 확정 공개', done: e.schedule_published, detail: e.schedule_published ? '공개됨' : '참가자에게 ‘초안’으로 표시 중' },
        { key: 'parking', label: '주차 안내(3시간 무료·초과 개인 부담) 확인 후 공개', done: e.parking_published, detail: e.parking_published ? '공개됨' : '미공개' },
        { key: 'return_bus', label: '귀가 버스 배차 안내 입력', done: e.return_bus_published && !!e.return_bus_note, detail: e.return_bus_note ? (e.return_bus_published ? '공개됨' : '입력됨 · 미공개') : '미입력' },
        { key: 'rules', label: '경기별 동률·교체·실패 기준, 제기차기 배점 해석 확정', done: false, detail: '현장 심판 브리핑에서 확정 (앱 자동채점 없음)' },
      ],
    };
  });
}
