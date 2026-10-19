import { loadConfig, ConfigError } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { buildApp } from './app.js';
import { applyBootstrapOwners } from './cli-ops.js';

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) { console.error(err.message); process.exit(1); }
    throw err;
  }
  const db = createPool(config.databaseUrl);
  await migrate(db);
  const ev = await db.query('SELECT 1 FROM events WHERE id=$1', [config.eventId]);
  if (!ev.rows[0]) {
    console.error(`행사(${config.eventId})가 초기화되지 않았습니다. 먼저 \`npm run cli -- init-event\`를 실행하세요.`);
    process.exit(1);
  }
  if (config.bootstrapOwnerIds.length) await applyBootstrapOwners(db, config.eventId, config.bootstrapOwnerIds);
  if (config.cancelPasswordIsDefault) console.warn('[config] 점수 취소 비밀번호가 기본값(1234)입니다. 운영 시 SCORE_CANCEL_PASSWORD_HASH 설정을 권장합니다.');
  const { app } = await buildApp(config, db);
  await app.listen({ port: config.port, host: config.host });
  const shutdown = async () => { await app.close(); await db.end(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => { console.error(err); process.exit(1); });
