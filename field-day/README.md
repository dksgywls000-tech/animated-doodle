# 2026 하이테크본부 가을운동회 — 모바일 웹앱

참가자가 QR로 접속해 **이름+사번**으로 입장하면 사전 배정된 **조**와 **행운권 번호**를 확인하고, 일정·지도·전체/조 채팅을 이용합니다. 지정 관리자만 **8개 조 점수판·부여·취소·감사 로그**를 봅니다.

- 서버: Node 22 + TypeScript, Fastify 5, WebSocket(`ws`), PostgreSQL 16
- 클라이언트: React 19 + Vite (같은 서버가 서빙)
- 폰트: Pretendard (SIL Open Font License 1.1, npm `pretendard` 패키지에서 자체 호스팅)
- 외부 유료 서비스 의존 없음. **외부 배포·QR 생성은 하지 않습니다.**

## 문서
| 문서 | 내용 |
|---|---|
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | 권한·행운권·점수 원장 설계 요약 |
| [docs/OPERATOR_MANUAL.md](docs/OPERATOR_MANUAL.md) | 운영자 매뉴얼 (owner 지정, 명단, 점수, 비밀번호, 백업·삭제) |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | 배포 준비 안내 (직접 배포용) |
| [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md) | 실행한 테스트와 결과, 알려진 미완료 사항 |

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
