# 어반웨이브 2026 더블 · 인스타 릴스 (TTS + 모션그래픽)

Remotion(React)으로 만든 1080×1920 · 30fps 릴스입니다. 대본·자막은 `script.json` 하나에서 관리하고,
씬 길이는 TTS 음성 길이에 맞춰 자동으로 계산합니다.

## 결과물 (`out/`)

| 파일 | 내용 |
|---|---|
| `urbanwave_reels_final.mp4` | 내레이션 + BGM + 효과음 (H.264 + AAC, -14 LUFS) |
| `urbanwave_reels_voice_only.mp4` | 내레이션만 |
| `urbanwave_reels_cover.png` | 커버 1080×1920 (제목은 4:5 영역 y 285–1635 안) |
| `srt/urbanwave_reels.srt` | 자막 |

## 대본을 고치고 다시 렌더하기

```bash
# 1) script.json 의 tts(읽는 문장) / caption(화면 자막) 수정
#    caption: **강조** = 그린 그라데이션, ~~취소~~ = 취소선
# 2) 전체 다시 렌더 (TTS → 길이 측정 → 영상 → 오디오 → mp4·커버·SRT → 가림 영역 검사)
./render.sh
```

`npm run studio` 로 브라우저에서 미리보기·스크러빙할 수 있습니다.

## 처음 설치

```bash
npm ci
pip install edge-tts sherpa-onnx numpy pillow
./tools/get_fallback_voice.sh   # edge-tts 접속이 안 될 때 쓰는 오프라인 한국어 모델 (선택)
```

Chrome 다운로드가 막힌 환경이면 `REMOTION_BROWSER=/path/to/chrome ./render.sh`처럼 브라우저 경로를 지정하세요.

## 음성

`script.json`의 `voice` 항목에서 정합니다.

- `engine: "auto"`: edge-tts(`ko-KR-InJoonNeural`, `+12%`)를 먼저 시도하고, 접속이 안 되면 오프라인 폴백(sherpa-onnx VITS, KSS 여성 음성)을 씁니다.
- `engine: "edge"`: edge-tts만 씁니다. 실패하면 렌더를 멈춥니다(폴백 음성으로 잘못 나가는 것을 막을 때).
- 총 길이가 `targetSec`(28–34초)를 벗어나면 생성 음성의 속도를 자동으로 조정해 다시 만듭니다.
- 직접 녹음한 파일로 바꾸려면 `voice_override/scene01.mp3` …를 넣고 `./render.sh`를 실행하세요. 타이밍은 자동으로 다시 맞춰집니다.

## BGM·효과음

`tools/make_audio_assets.py`가 코드로 직접 합성합니다. 외부 샘플을 쓰지 않아 저작권 문제가 없습니다.

- BGM: 128BPM 일렉트로닉 루프. 내레이션보다 약 17–18dB 낮게 들어갑니다(기본 `BGM_VOL=0.065`).
- 효과음: whoosh(컷 전환), thud·stamp(슬램), pop, tick.
- 다른 저작권 프리 BGM을 쓰려면 파일을 `public/bgm/`에 넣고 `BGM_FILE=bgm/파일명.mp3 ./render.sh`를 실행하세요.

## 구조

```
script.json              대본·자막·음성 설정 (여기만 고치면 됨)
render.sh                전체 파이프라인
tools/tts.py             씬별 TTS 생성 + 길이 측정 → src/generated/timing.json
tools/make_audio_assets.py  BGM·효과음 합성
tools/make_srt.py        SRT 생성
tools/qa.py              검수 (씬별 프레임 시트 / 가림 영역 자동 검사)
src/scenes.tsx           10개 씬 모션그래픽
src/cues.ts              씬별 타이밍 큐 (애니메이션과 효과음이 같이 사용)
src/components.tsx       네온 터널, 자막, 카드 등 공통 요소
src/theme.ts             디자인 토큰 (BRIEF 4번)
voice_override/          직접 만든 음성 파일 넣는 곳
```

## 검수

- `./render.sh` 마지막 단계에서 배경을 뺀 QA 영상을 렌더해, 모든 프레임의 금지 영역(y<250, y>1570, 오른쪽 하단 x≥900 & y 1100–1570)에 글자나 요소가 있는지 검사합니다.
- `python3 tools/qa.py sheets .tmp/video.mp4 <폴더>`: 씬마다 3프레임을 뽑아 가림 영역 오버레이를 그린 시트를 만듭니다.

## 내용 원칙 (BRIEF.md)

- 수치는 BRIEF 6번 표에 있는 것만 씁니다.
- 월볼 공중 캐치는 "해석이 갈림 · 브리핑 때 확인"으로만 표현합니다.
- 공식 로고는 쓰지 않고 'URBANWAVE 2026 · DOUBLES' 텍스트만 씁니다.
- 마지막 씬에 "참가자가 만든 비공식 요약 · 최종 해석은 조직위·현장 심판"을 표기합니다.
