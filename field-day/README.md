# 2026 하이테크본부 가을운동회 — 모바일 웹앱

참가자가 QR로 접속해 **이름+사번**으로 입장하면 사전 배정된 **조**와 **행운권 번호**를 확인하고, 일정·지도·전체/조 채팅을 이용합니다. 지정 관리자만 **8개 조 점수판·부여·취소·감사 로그**를 봅니다.

- 서버: Node 22 + TypeScript, Fastify 5, WebSocket(`ws`), PostgreSQL 16
- 클라이언트: React 19 + Vite (같은 서버가 서빙)
- 폰트: Pretendard (SIL Open Font License 1.1, npm `pretendard` 패키지에서 자체 호스팅)
- 외부 유료 서비스 의존 없음. **외부 배포·QR 생성은 하지 않습니다.**

## 배포 방식: Netlify(화면) + Firebase(서버)
**실제 행사용 배포는 [docs/FIREBASE_NETLIFY_GUIDE.md](docs/FIREBASE_NETLIFY_GUIDE.md)를 순서대로 따라 하세요.** Netlify에 끌어다 놓을 폴더는 `npm run package:netlify`로 만듭니다(`dist/netlify-upload.zip`).

| 폴더 | 내용 |
|---|---|
| `client/src` | 화면(React). 모든 배포 방식이 같이 씀 |
| `client/firebase` | Firebase 연결 어댑터 + `/setup` 최초 설정 화면 (Netlify 빌드: `npm run build:netlify`) |
| `firebase/functions` | Cloud Functions: 로그인·행운권 배정, 점수 부여·취소, 명단·권한 |
| `firebase/firestore.rules` | 보안 규칙: 참가자에게 점수·다른 조 채팅·사번 차단 |
| `netlify.toml` | Netlify 빌드·헤더 설정 (Base directory = `field-day`) |
| `server/` | (대안) Node + PostgreSQL 단독 서버 버전 — 인원 추가·행운권 초기화·운영진 조는 Firebase 버전에만 있음 |
| `preview/field-day-demo.html` | 설치 없이 여는 미리보기 데모 |

Firebase 버전 테스트: `npm run test:firebase`(에뮬레이터 72개 항목), `bash scripts/firebase-ui-test.sh`(Netlify 빌드 브라우저 흐름).

## 문서
| 문서 | 내용 |
|---|---|
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | 권한·행운권·점수 원장 설계 요약 |
| [docs/OPERATOR_MANUAL.md](docs/OPERATOR_MANUAL.md) | 운영자 매뉴얼 (owner 지정, 명단, 점수, 비밀번호, 백업·삭제) |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | 배포 준비 안내 (직접 배포용) |
| [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md) | 실행한 테스트와 결과, 알려진 미완료 사항 |

## 설치 없이 미리보기 (HTML 파일 1개)
[`preview/field-day-demo.html`](preview/field-day-demo.html)을 내려받아 더블클릭하면 브라우저에서 바로 열립니다.
- 실제 앱과 같은 화면 코드에 **브라우저 안 가짜 백엔드**를 붙인 데모입니다. 데이터는 그 브라우저(localStorage)에만 저장되고 다른 사람·기기와 공유되지 않습니다.
- 같은 파일을 탭 2개로 열어 관리자·참가자로 각각 입장하면 점수·채팅 실시간 반영을 볼 수 있습니다. 왼쪽 아래 탭바 위 **DEMO** 버튼에서 시각 가정·초기화를 할 수 있습니다.
- **실제 행사용이 아닙니다.** 행운권 중복 방지, 점수 비공개, 명단 보호는 서버 버전에서만 보장됩니다.
- 다시 만들기: `npm run build:demo`

## 로컬 실행 (데모 모드)
```bash
cd field-day
npm ci
cp .env.example .env          # DATABASE_URL 수정, APP_MODE=demo, COOKIE_SECURE=false
npm run cli -- seed-demo      # 마이그레이션 + 행사 초기화 + 가상 TEST 명단(roster_template.csv)
npm run build && npm start    # http://localhost:3000
```
개발 중에는 `npm run dev:server`(3000)와 `npm run dev:client`(5173, /api·/ws 프록시)를 각각 실행합니다.

데모 계정 예: `테스트총괄 / TEST-0001`(owner), `테스트관리자 / TEST-0002`(admin), `테스트참가자 가 / TEST-0003`, `테스트영시작 / 000123`. 모두 가상 데이터입니다.

## 테스트
```bash
npm run typecheck
npm test            # 실제 PostgreSQL에 테스트 DB를 만들어 실행 (TEST_DATABASE_ADMIN_URL로 접속 변경)
npm run test:e2e    # 빌드 후 3100 포트에 새 데모 DB로 서버를 띄워 Chromium으로 검증
```

## 이미지 자료
`public/assets/`에는 스캔 원본에서 추출한 01~09 이미지를 크기만 줄여 넣었습니다(`scripts/prepare_assets.py`, 허용 목록 방식).
**`10_staff_schedule.png`(내부 운영자료)와 행사 요약 MD는 저장소·공개 폴더에 포함하지 않았습니다.**
