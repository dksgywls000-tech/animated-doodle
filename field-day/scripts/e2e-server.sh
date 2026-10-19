#!/usr/bin/env bash
# E2E용: 새 데모 DB를 만들고 빌드된 서버를 3100 포트로 실행
set -euo pipefail
ADMIN_URL="${E2E_ADMIN_URL:-postgres://fieldday:fieldday@localhost:5432/postgres}"
DB=fieldday_e2e
psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"
export DATABASE_URL="${ADMIN_URL%/*}/$DB" APP_MODE=demo PORT=3100 COOKIE_SECURE=false
npx tsx server/cli.ts seed-demo
exec node dist/server/index.js
