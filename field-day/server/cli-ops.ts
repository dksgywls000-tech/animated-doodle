import type { Db } from './db.js';

export async function applyBootstrapOwners(db: Db, eventId: string, employeeIds: string[]) {
  for (const id of employeeIds) {
    const { rows } = await db.query(
      `UPDATE participants SET role='owner', updated_at=now() WHERE event_id=$1 AND employee_id=$2 AND role<>'owner' RETURNING id, name`,
      [eventId, id],
    );
    if (rows[0]) {
      await db.query(`INSERT INTO audit_events (event_id, actor_name, action, target) VALUES ($1,'SERVER_ENV','bootstrap_owner',$2)`, [eventId, rows[0].id]);
      console.log(`[bootstrap] owner 지정: ${rows[0].name}`);
    }
  }
}
