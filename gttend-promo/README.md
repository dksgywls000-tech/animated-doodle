# GRACE TEN — 25초 홍보 모션그래픽 (GTTEND RUN CLUB)

- 결과물: `build/grace-ten-promo.mp4` (1080×1920 세로, 30fps, 25초, 사운드 포함)
- `index.html` — 전체 애니메이션(타임라인 기반 `render(t)`). 브라우저에서 열면 실시간 미리보기가 재생됩니다.
- `audio.py` — 사운드트랙을 코드로 직접 합성 (120 BPM, 컷·타이포 슬램·체크 틱이 비트에 맞춰 떨어짐)
- `render.js` — Playwright로 프레임을 캡처한 뒤 ffmpeg로 합성

## 다시 렌더하기
```
pip install numpy imageio-ffmpeg
NODE_PATH=$(npm root -g) node render.js
```
`img/`에 `run.jpg row.jpg ski.jpg lunge.jpg squat.jpg duo.jpg`를 넣으면
(Higgsfield로 생성한 사진) 해당 장면 배경에 블루 듀오톤으로 자동으로 합성됩니다.

## 구성 (120 BPM, 1비트 = 0.5초)
| 시간 | 장면 |
|---|---|
| 0–2s | GTTEND 스파클 로고 인트로 |
| 2–4.5s | 뛰고, 밀고, 당기고, 들고. — 비트마다 키네틱 타이포 |
| 4.5–7.5s | GRACE TEN 타이틀 임팩트 + HYBRID SESSION |
| 7.5–9.5s | 8팀 · 2인 1팀 · 10개의 체크 · 1개의 목표 |
| 9.5–15.5s | 5개 스테이션 픽토그램 + 10칸 체크바 → 10/10 |
| 15.5–18.5s | 룰: 순서 자유 / 나눠서 250m+250m / 외부 도움 없이 |
| 18.5–20s | COMPLETE 10. FINISH FIRST. + 완료 스탬프 |
| 20–21.5s | 연휴에 먹을 거라면, 일단 태울 자리부터 예약하세요 🔥 |
| 21.5–23.5s | 9/27 SUN · AM 8:00 · 빌드업 피트니스 + 파트너 티커 |
| 23.5–25s | 끝까지, 우아하게. · 참가 문의 DM |
