#!/usr/bin/env bash
# Netlify용 빌드를 에뮬레이터 연결 모드로 만들고, 에뮬레이터 안에서 브라우저 흐름을 검증
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
OUT="$ROOT/dist/netlify-emu"
printf 'SETUP_KEY=test-setup-key-123\nRATE_LIMIT_SECRET=test-rate-limit-secret-0123\nCANCEL_PASSWORD_HASH=\n' > firebase/functions/.env.local
npm --prefix firebase/functions run build
VITE_FIREBASE_API_KEY=fake VITE_FIREBASE_PROJECT_ID=demo-fieldday VITE_FIREBASE_APP_ID=fake VITE_FIREBASE_AUTH_DOMAIN=localhost \
  VITE_USE_EMULATORS=true VITE_EMULATOR_HOST=127.0.0.1 npx vite build --config vite.netlify.config.ts --outDir "$OUT" >/dev/null
node scripts/netlify-finish.mjs "$OUT"
cat > "$ROOT/dist/run-ui.sh" <<INNER
cd "$ROOT"
(npx vite preview --config vite.netlify.config.ts --outDir "$OUT" --port 4173 --host 127.0.0.1 >/dev/null 2>&1 &)
sleep 3
node e2e/firebase-ui.mjs
INNER
cd firebase
npx -y firebase-tools@15.34.0 emulators:exec --project demo-fieldday --only auth,firestore,functions "bash $ROOT/dist/run-ui.sh"
