import type { FastifyInstance } from 'fastify';
import { requireOwner, sendCsv, type AppDeps } from '../app.js';
import { changeTeam, commitRoster, previewRoster, setRole } from '../services/roster.js';
import { AppError, formatSeoul, toCsv } from '../util.js';

const UUID = /^[0-9a-f-]{36}$/i;
const MAX_CSV = 512 * 1024;

export function registerOwnerRoutes(api: FastifyInstance, { config, db, hub }: AppDeps) {
  const ev = config.eventId;
  const csvBody = (b: unknown) => {
    const text = (b as { csv?: unknown } | undefined)?.csv;
    if (typeof text !== 'string' || !text.trim()) throw new AppError(400, 'empty_csv', 'CSV 파일 내용을 확인해 주세요.');
    if (text.length > MAX_CSV) throw new AppError(400, 'csv_too_large', 'CSV가 너무 큽니다.');
    return text;
  };

  api.post('/owner/roster/preview', async (req) => {
    const u = requireOwner(req);
    const plan = await previewRoster(db, ev, u.participantId, csvBody(req.body));
    return {
      inserts: plan.inserts.length,
      updates: plan.updates.map((x) => ({ line: x.row.line, name: x.row.name, teamNumber: x.row.teamNumber, changes: x.changes })),
      roleChanges: plan.roleChanges,
      unchanged: plan.unchanged,
      untouchedExisting: plan.untouchedExisting,
      errors: plan.errors,
      sample: plan.inserts.slice(0, 5).map((r) => ({ line: r.line, name: r.name, teamNumber: r.teamNumber, role: r.role, active: r.active })),
    };
  });

  api.post('/owner/roster/commit', async (req) => {
    const u = requireOwner(req);
    const b = (req.body ?? {}) as { confirmRoleChanges?: unknown };
    const { plan, affected } = await commitRoster(db, ev, { id: u.participantId, name: u.name }, csvBody(req.body), b.confirmRoleChanges === true);
    for (const id of affected) await hub.revalidate(id);
    return { inserted: plan.inserts.length, updated: plan.updates.length, unchanged: plan.unchanged };
  });

  api.post<{ Params: { id: string } }>('/owner/participants/:id/role', async (req) => {
    const u = requireOwner(req);
    if (!UUID.test(req.params.id)) throw new AppError(404, 'not_found', '참가자를 찾을 수 없습니다.');
    const result = await setRole(db, ev, { id: u.participantId, name: u.name }, req.params.id, (req.body as { role?: unknown } | undefined)?.role);
    await hub.revalidate(req.params.id);
    return result;
  });

  api.post<{ Params: { id: string } }>('/owner/participants/:id/team', async (req) => {
    const u = requireOwner(req);
    if (!UUID.test(req.params.id)) throw new AppError(404, 'not_found', '참가자를 찾을 수 없습니다.');
    const b = (req.body ?? {}) as { teamNumber?: unknown; reason?: unknown };
    const result = await changeTeam(db, ev, { id: u.participantId, name: u.name }, req.params.id, b.teamNumber, b.reason);
    await hub.revalidate(req.params.id);
    return result;
  });

  api.get('/owner/audit', async (req) => {
    requireOwner(req);
    const { rows } = await db.query(`SELECT id, actor_name, action, target, detail, created_at FROM audit_events WHERE event_id=$1 ORDER BY created_at DESC LIMIT 300`, [ev]);
    return { events: rows.map((r) => ({ id: r.id, actorName: r.actor_name, action: r.action, target: r.target, detail: r.detail, createdAt: r.created_at })) };
  });

  api.get('/owner/export/checkins.csv', async (req, reply) => {
    const u = requireOwner(req);
    const { rows } = await db.query(
      `SELECT p.employee_id, p.name, p.team_number, p.role, p.active, c.checkin_sequence, c.ticket_number, c.checked_in_at
       FROM participants p LEFT JOIN checkins c ON c.participant_id=p.id AND c.event_id=p.event_id
       WHERE p.event_id=$1 ORDER BY p.team_number, p.name`,
      [ev],
    );
    await db.query(`INSERT INTO audit_events (event_id, actor_id, actor_name, action) VALUES ($1,$2,$3,'export_checkins')`, [ev, u.participantId, u.name]);
    return sendCsv(reply, 'checkins.csv', toCsv(
      ['사번', '이름', '조', '역할', '활성', '체크인순번', '행운권', '체크인시각(KST)'],
      rows.map((r) => [r.employee_id, r.name, r.team_number, r.role, r.active ? 'Y' : 'N', r.checkin_sequence ?? '', r.ticket_number ? String(r.ticket_number).padStart(3, '0') : '', r.checked_in_at ? formatSeoul(r.checked_in_at) : '']),
    ));
  });

  api.get('/owner/export/audit.csv', async (req, reply) => {
    const u = requireOwner(req);
    const { rows } = await db.query(`SELECT actor_name, action, target, detail, created_at FROM audit_events WHERE event_id=$1 ORDER BY created_at`, [ev]);
    await db.query(`INSERT INTO audit_events (event_id, actor_id, actor_name, action) VALUES ($1,$2,$3,'export_audit')`, [ev, u.participantId, u.name]);
    return sendCsv(reply, 'audit.csv', toCsv(['시각(KST)', '수행자', '동작', '대상', '상세'],
      rows.map((r) => [formatSeoul(r.created_at), r.actor_name ?? '', r.action, r.target ?? '', JSON.stringify(r.detail)])));
  });
}
