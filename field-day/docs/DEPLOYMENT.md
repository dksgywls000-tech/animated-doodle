# 배포 준비 안내 (직접 배포용)

이 저장소는 자동 배포를 하지 않습니다. 아래는 운영자가 직접 배포할 때의 체크리스트입니다.

## 필요 환경
- Node.js 22 이상, PostgreSQL 14 이상(개발·테스트는 16)
- HTTPS 종단(리버스 프록시·PaaS 기본 TLS 등). WebSocket(`/ws`) 업그레이드를 통과시켜야 합니다.
- 동시 접속 약 300~400명 기준 단일 인스턴스(1 vCPU / 1GB)로 충분하도록 설계했습니다. 여러 인스턴스를 띄워도 실시간 이벤트는 Postgres LISTEN/NOTIFY로 공유됩니다.

## 절차
```bash
npm ci
npm run build                 # dist/client + dist/server
npm run cli -- init-event     # 최초 1회 (마이그레이션 포함, 재실행 안전)
npm run cli -- import-roster /secure/path/roster.csv --confirm-role-changes
NODE_ENV=production npm start # 시작 시 마이그레이션 확인, 미초기화면 이유를 출력하고 종료
```
`npm start`는 `.env`가 있으면 읽습니다. PaaS에서는 환경변수로 설정하세요.

## 환경변수 (요약 — `.env.example` 참고)
| 이름 | 필수 | 설명 |
|---|---|---|
| `DATABASE_URL` | ✔ | PostgreSQL 접속 문자열 |
| `APP_MODE` | ✔ | `production` (데모 명단 생성 금지) |
| `RATE_LIMIT_SECRET` | ✔(production) | 16자 이상 임의 문자열 |
| `SCORE_CANCEL_PASSWORD_HASH` | 권장 | 없으면 기본 1234 |
| `TRUST_PROXY` | 프록시 뒤 | `true`면 X-Forwarded-For로 클라이언트 IP 판별 |
| `COOKIE_SECURE` | | production 기본 true (HTTP로 테스트할 때만 false) |
| `ALLOWED_ORIGINS` | | 다른 도메인에서 접근시킬 때만 |

필수값이 없으면 서버가 무엇이 필요한지 출력하고 시작하지 않습니다.

## 보안 동작 확인
- 세션: HttpOnly·SameSite=Lax·(production) Secure 쿠키, DB에 토큰 해시만 저장, 36시간 만료.
- 변경 요청: Origin 검사 + 세션별 CSRF 토큰 헤더.
- 응답: `/api/*` 전부 `Cache-Control: no-store`, CSP·nosniff·frame 차단. 서비스워커 없음(민감 화면 오프라인 캐시 없음).
- 로그: 요청 본문·쿼리·쿠키를 로그에 남기지 않음.
- `public/assets`에는 공개용 이미지 01~09만 있습니다. 배포 전에 `ls dist/client/assets`로 `10_staff_schedule`이 없는지 확인하세요.

## 배포 후
1. `https://<도메인>/api/health` → `{"ok":true}`
2. owner로 로그인 → 체크리스트 확인 → 테스트 계정으로 채팅·점수 부여/취소 리허설 후 리허설 기록은 취소 처리(원장은 지워지지 않으므로 리허설은 별도 DB에서 하는 것을 권장).
3. URL로 QR을 직접 제작합니다.
