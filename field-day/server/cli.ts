/**
 * 운영 CLI
 *   npm run cli -- migrate
 *   npm run cli -- init-event
 *   npm run cli -- import-roster <file.csv> [--confirm-role-changes]
 *   npm run cli -- add-owner --employee-id <ID> --name <이름> --team <1-8>
 *   npm run cli -- set-role --employee-id <ID> --role <participant|admin|owner>
 *   npm run cli -- seed-demo           (APP_MODE=demo 에서만)
 *   npm run cli -- status
 *   npm run hash-password              (취소 비밀번호 해시 생성)
 */
import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { loadConfig, hashPassword } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { initEvent } from './services/eventSetup.js';
import { commitRoster } from './services/roster.js';
import { AppError, normalizeEmployeeId, normalizeName } from './util.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function decodeCsv(buf: Buffer): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('euc-kr').decode(buf); }
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'hash-password') {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const pw = (await rl.question('새 취소 비밀번호: ')).trim();
    rl.close();
    if (pw.length < 4) { console.error('4자 이상 입력하세요.'); process.exit(1); }
    console.log(`\nSCORE_CANCEL_PASSWORD_HASH='${hashPassword(pw)}'`);
    return;
  }
  const config = loadConfig();
  const db = createPool(config.databaseUrl, 4);
  try {
    switch (cmd) {
      case 'migrate':
        await migrate(db);
        break;
      case 'init-event': {
        await migrate(db);
        const r = await initEvent(db, config.eventId);
        console.log(r.created ? `행사 ${config.eventId} 초기화 완료 (행운권 1~300 셔플 풀 생성)` : `행사 ${config.eventId}는 이미 초기화되어 있습니다. 변경 없음.`);
        break;
      }
      case 'import-roster': {
        const file = process.argv[3];
        if (!file) throw new Error('CSV 파일 경로를 지정하세요.');
        const text = decodeCsv(readFileSync(file));
        const { plan } = await commitRoster(db, config.eventId, { id: null, name: 'CLI' }, text, process.argv.includes('--confirm-role-changes'));
        console.log(`명단 반영 완료: 추가 ${plan.inserts.length} / 갱신 ${plan.updates.length} / 변경없음 ${plan.unchanged}`);
        break;
      }
      case 'add-owner': {
        const employeeId = normalizeEmployeeId(arg('--employee-id'));
        const name = normalizeName(arg('--name'));
        const team = Number(arg('--team'));
        if (!employeeId || !name || !(team >= 1 && team <= 8)) throw new Error('--employee-id, --name, --team(1~8)을 모두 지정하세요.');
        const { rows } = await db.query(
          `INSERT INTO participants (event_id, employee_id, name, team_number, role) VALUES ($1,$2,$3,$4,'owner')
           ON CONFLICT (event_id, employee_id) DO UPDATE SET role='owner', updated_at=now() RETURNING id, (xmax=0) AS inserted`,
          [config.eventId, employeeId, name, team],
        );
        await db.query(`INSERT INTO audit_events (event_id, actor_name, action, target) VALUES ($1,'CLI','add_owner',$2)`, [config.eventId, rows[0].id]);
        console.log(rows[0].inserted ? 'owner 추가 완료' : '기존 명단 행을 owner로 지정했습니다');
        break;
      }
      case 'set-role': {
        const employeeId = normalizeEmployeeId(arg('--employee-id'));
        const role = arg('--role');
        if (!employeeId || !['participant', 'admin', 'owner'].includes(role ?? '')) throw new Error('--employee-id와 --role(participant|admin|owner)을 지정하세요.');
        const { rows } = await db.query(`UPDATE participants SET role=$3, updated_at=now() WHERE event_id=$1 AND employee_id=$2 RETURNING id`, [config.eventId, employeeId, role]);
        if (!rows[0]) throw new Error('해당 사번이 명단에 없습니다.');
        await db.query(`INSERT INTO audit_events (event_id, actor_name, action, target, detail) VALUES ($1,'CLI','role_change',$2,$3)`, [config.eventId, rows[0].id, JSON.stringify({ to: role })]);
        console.log('역할 변경 완료 (기존 세션에도 다음 요청부터 반영됩니다)');
        break;
      }
      case 'seed-demo': {
        if (config.mode !== 'demo') throw new Error('seed-demo는 APP_MODE=demo에서만 실행할 수 있습니다. 실제 운영 DB에 가상 참가자를 만들지 않습니다.');
        await migrate(db);
        await initEvent(db, config.eventId);
        const tpl = ['../roster_template.csv', '../../roster_template.csv'].map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u))!;
        const text = readFileSync(tpl, 'utf8');
        const { plan } = await commitRoster(db, config.eventId, { id: null, name: 'DEMO-SEED' }, text, true);
        const ann = await db.query(`SELECT 1 FROM announcements WHERE event_id=$1 LIMIT 1`, [config.eventId]);
        if (!ann.rows[0]) {
          await db.query(`INSERT INTO announcements (event_id, title, body, important) VALUES ($1,$2,$3,true), ($1,$4,$5,false)`, [
            config.eventId,
            '[데모] 조끼는 도착 후 조별 자리에서 받으세요', '데모용 공지입니다. 실제 공지는 운영진이 관리자 화면에서 작성합니다.',
            '[데모] 그늘 공간 이동 가능', '좌석 지도 왼쪽 그늘 공간으로 이동할 수 있습니다.',
          ]);
        }
        console.log(`데모 명단 반영: 추가 ${plan.inserts.length} / 갱신 ${plan.updates.length}`);
        break;
      }
      case 'status': {
        const r = await db.query(
          `SELECT (SELECT count(*) FROM participants WHERE event_id=$1) AS roster,
                  (SELECT count(*) FROM checkins WHERE event_id=$1) AS checkins,
                  (SELECT next_sequence FROM allocation_state WHERE event_id=$1) AS next_seq,
                  (SELECT count(*) FROM score_awards WHERE event_id=$1) AS awards,
                  (SELECT count(*) FROM score_reversals WHERE event_id=$1) AS reversals`,
          [config.eventId],
        );
        console.table(r.rows[0]);
        break;
      }
      default:
        console.log('사용법: migrate | init-event | import-roster <csv> | add-owner | set-role | seed-demo | status | hash-password');
        process.exitCode = 1;
    }
  } catch (err) {
    if (err instanceof AppError) {
      console.error(err.message);
      const extra = err.extra as { errors?: { line: number; reason: string }[]; roleChanges?: unknown[] };
      for (const e of extra.errors ?? []) console.error(`  ${e.line}행: ${e.reason}`);
      if (extra.roleChanges) console.error('  역할 변경 포함 — 확인 후 --confirm-role-changes 옵션으로 다시 실행하세요.', extra.roleChanges);
    } else console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

void main();
