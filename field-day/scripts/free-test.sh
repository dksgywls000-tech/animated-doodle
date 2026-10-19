#!/usr/bin/env bash
# 무료 요금제 버전: 규칙·동시성 테스트 + 실제 화면 흐름 테스트 (Firestore/Auth 에뮬레이터, Functions 없음)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"; OUT="$ROOT/dist/netlify-free-emu"
VITE_FIREBASE_API_KEY=fake VITE_FIREBASE_PROJECT_ID=demo-fieldday VITE_FIREBASE_APP_ID=fake VITE_FIREBASE_AUTH_DOMAIN=localhost \
  VITE_USE_EMULATORS=true VITE_EMULATOR_HOST=127.0.0.1 npx vite build --config vite.free.config.ts --outDir "$OUT" >/dev/null
node scripts/netlify-finish.mjs "$OUT" >/dev/null
cat > "$ROOT/dist/run-free.sh" <<INNER
cd "$ROOT"
[ -n "${SKIP_RULES:-}" ] || node scripts/free-rules-test.mjs
curl -s -X DELETE "http://127.0.0.1:8080/emulator/v1/projects/demo-fieldday/databases/(default)/documents" >/dev/null
(npx vite preview --config vite.free.config.ts --outDir "$OUT" --port 4174 --host 127.0.0.1 >/dev/null 2>&1 &)
sleep 3
BASE=http://127.0.0.1:4174 node e2e/free-ui.mjs
INNER
cd firebase-free
npx -y firebase-tools@15.34.0 emulators:exec --project demo-fieldday --only auth,firestore "bash $ROOT/dist/run-free.sh"
