import pg from 'pg';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { loadConfig, type Config } from '../server/config.js';
import { createPool, type Db } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import { initEvent } from '../server/services/eventSetup.js';
import { buildApp } from '../server/app.js';

export const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://fieldday:fieldday@localhost:5432/postgres';

export interface TestCtx {
  db: Db;
  config: Config;
  app: FastifyInstance;
  dbName: string;
  url: string;
  close: () => Promise<void>;
}

/** 테스트 파일마다 독립된 실제 PostgreSQL DB를 만든다 */
export async function createTestContext(env: Record<string, string> = {}): Promise<TestCtx> {
  const dbName = 'fd_test_' + randomBytes(5).toString('hex');
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const url = ADMIN_URL.replace(/\/[^/]+$/, '/' + dbName);
  const config = loadConfig({ DATABASE_URL: url, APP_MODE: 'demo', EVENT_ID: 'test-event', ...env });
  const db = createPool(url, 40);
  await migrate(db, () => {});
  await initEvent(db, config.eventId);
  const { app } = await buildApp(config, db, { serveClient: false, logger: false });
  await app.ready();
  return {
    db, config, app, dbName, url,
    close: async () => {
      await app.close();
      await db.end();
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await a.end();
    },
  };
}

export async function addParticipants(db: Db, eventId: string, rows: { employeeId: string; name: string; team: number; role?: string; active?: boolean }[]) {
  const ids: string[] = [];
  for (const r of rows) {
    const { rows: out } = await db.query(
      `INSERT INTO participants (event_id, employee_id, name, team_number, role, active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [eventId, r.employeeId, r.name, r.team, r.role ?? 'participant', r.active ?? true],
    );
    ids.push(out[0].id);
  }
  return ids;
}

export async function bulkParticipants(db: Db, eventId: string, n: number, prefix = 'P') {
  await db.query(
    `INSERT INTO participants (event_id, employee_id, name, team_number)
     SELECT $1, $2 || lpad(g::text, 4, '0'), '참가자' || g, ((g - 1) % 8) + 1 FROM generate_series(1, $3) g`,
    [eventId, prefix, n],
  );
  const { rows } = await db.query(`SELECT id, employee_id, name FROM participants WHERE event_id=$1 AND employee_id LIKE $2 || '%' ORDER BY employee_id`, [eventId, prefix]);
  return rows as { id: string; employee_id: string; name: string }[];
}

export interface Session { cookie: string; csrf: string }

export async function loginAs(app: FastifyInstance, name: string, employeeId: string, ip = '10.0.0.1'): Promise<Session> {
  const res = await app.inject({ method: 'POST', url: '/api/login', payload: { name, employeeId }, remoteAddress: ip });
  if (res.statusCode !== 200) throw new Error(`login failed ${res.statusCode} ${res.body}`);
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie!;
  return { cookie: raw.split(';')[0], csrf: res.json().csrfToken };
}

export function req(app: FastifyInstance, s: Session | null, method: string, url: string, payload?: unknown) {
  return app.inject({
    method: method as never, url, payload: payload as never,
    headers: s ? { cookie: s.cookie, 'x-csrf-token': s.csrf } : {},
  });
}

export const key = () => randomBytes(12).toString('hex');
