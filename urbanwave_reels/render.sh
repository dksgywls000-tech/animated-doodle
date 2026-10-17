#!/usr/bin/env bash
# 어반웨이브 2026 더블 릴스 전체 렌더
#   ./render.sh            → TTS 생성/측정 → 영상 → 오디오 2종 → mp4 2종 + 커버 + SRT
#   BGM_FILE=bgm/my.mp3 ./render.sh   → public/ 아래 다른 BGM 파일 사용
#   SKIP_QA=1 ./render.sh  → 금지 영역 자동 검사 생략
set -euo pipefail
cd "$(dirname "$0")"

# Chrome 다운로드가 막힌 환경이면 설치된 Chromium 사용
if [ -z "${REMOTION_BROWSER:-}" ] && [ -x /opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell ]; then
  export REMOTION_BROWSER=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell
fi
BGM_FILE="${BGM_FILE:-bgm/bgm_generated.wav}"
BGM_VOL="${BGM_VOL:-0.065}"
OUT=out
mkdir -p "$OUT/srt" .tmp

echo "▶ 1/6 TTS 생성 + 씬 길이 계산"
python3 tools/tts.py

echo "▶ 2/6 BGM·효과음"
[ -f public/bgm/bgm_generated.wav ] || python3 tools/make_audio_assets.py

echo "▶ 3/6 영상 렌더 (무음)"
npx remotion render src/index.ts Reel .tmp/video_raw.mp4 --muted --codec=h264 --crf=16 --log=error
# 인스타 호환: 풀레인지(yuvj420p) → 표준 yuv420p(BT.709, TV range)
ffmpeg -y -v error -i .tmp/video_raw.mp4 -vf "scale=out_range=tv:out_color_matrix=bt709,format=yuv420p" \
  -c:v libx264 -preset slow -crf 17 -profile:v high -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -r 30 .tmp/video.mp4

echo "▶ 4/6 오디오 믹스 (최종 / 음성만)"
npx remotion render src/index.ts Reel .tmp/final.wav --codec=wav --log=error \
  --props="{\"voice\":true,\"sfx\":true,\"music\":true,\"musicVolume\":$BGM_VOL,\"musicFile\":\"$BGM_FILE\"}"
npx remotion render src/index.ts Reel .tmp/voice.wav --codec=wav --log=error \
  --props="{\"voice\":true,\"sfx\":false,\"music\":false,\"musicVolume\":0,\"musicFile\":\"$BGM_FILE\"}"

echo "▶ 5/6 mp4 합치기 (-14 LUFS 맞춤)"
mux() { # $1 audio wav, $2 out mp4
  local lufs gain
  lufs=$(ffmpeg -hide_banner -nostats -i "$1" -af ebur128 -f null - 2>&1 | awk '/I:/{v=$2} END{print v}')
  gain=$(python3 -c "print(round(-14.0 - float('$lufs'), 2))")
  ffmpeg -y -v error -i .tmp/video.mp4 -i "$1" -map 0:v -map 1:a -c:v copy \
    -af "volume=${gain}dB,alimiter=limit=0.89:level=false" -c:a aac -b:a 192k -ar 48000 \
    -movflags +faststart -shortest "$2"
  echo "  $2  (원본 ${lufs} LUFS → ${gain} dB)"
}
mux .tmp/final.wav "$OUT/urbanwave_reels_final.mp4"
mux .tmp/voice.wav "$OUT/urbanwave_reels_voice_only.mp4"

echo "▶ 6/6 커버 + SRT"
npx remotion still src/index.ts Cover "$OUT/urbanwave_reels_cover.png" --log=error
python3 tools/make_srt.py "$OUT/srt/urbanwave_reels.srt"

if [ -z "${SKIP_QA:-}" ]; then
  echo "▶ QA: 금지 영역 자동 검사 (배경 제외 렌더)"
  npx remotion render src/index.ts Reel .tmp/qa.mp4 --muted --scale=0.5 --log=error --props='{"voice":false,"sfx":false,"music":false,"musicVolume":0,"musicFile":"","qaNoBg":true}'
  python3 tools/qa.py zones .tmp/qa.mp4
fi
ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/urbanwave_reels_final.mp4" | xargs printf "완료: 길이 %.2fs\n"
