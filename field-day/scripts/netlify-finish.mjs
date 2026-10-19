// vite 빌드 후 Netlify용 마무리: firebase-config.js, _redirects, _headers 생성
//   - Netlify가 GitHub에서 빌드할 때는 환경변수(VITE_FIREBASE_*) 값을 넣는다
//   - 값이 없으면 '여기에 ...' 자리표시를 넣어 두고, 사람이 메모장으로 채운다
import { writeFileSync } from 'node:fs';
const dir = process.argv[2] ?? 'dist/netlify';
const v = (k, label) => JSON.stringify(process.env[k] || `여기에 ${label} 붙여넣기`);
writeFileSync(`${dir}/firebase-config.js`, `// Firebase 연결 정보 — Firebase 콘솔 > 프로젝트 설정 > 내 앱(웹) > SDK 설정 및 구성(config)에서 복사
// 이 값들은 공개돼도 되는 값입니다(권한은 Firestore 보안 규칙이 지킵니다).
window.FIREBASE_CONFIG = {
  apiKey: ${v('VITE_FIREBASE_API_KEY', 'apiKey')},
  authDomain: ${v('VITE_FIREBASE_AUTH_DOMAIN', 'authDomain')},
  projectId: ${v('VITE_FIREBASE_PROJECT_ID', 'projectId')},
  appId: ${v('VITE_FIREBASE_APP_ID', 'appId')},
};
`);
writeFileSync(`${dir}/_redirects`, '/*  /index.html  200\n');
writeFileSync(`${dir}/_headers`, `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self' https://*.googleapis.com https://*.cloudfunctions.net https://*.run.app https://*.firebaseio.com wss://*.firebaseio.com; frame-src https://*.firebaseapp.com; frame-ancestors 'none'; base-uri 'none'
/index.html
  Cache-Control: no-cache
/firebase-config.js
  Cache-Control: no-cache
/bundle/*
  Cache-Control: public, max-age=31536000, immutable
`);
console.log(`${dir}: firebase-config.js, _redirects, _headers 작성`);
