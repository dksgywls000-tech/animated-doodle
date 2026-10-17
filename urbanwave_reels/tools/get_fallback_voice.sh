#!/usr/bin/env bash
# edge-tts에 접속할 수 없을 때 쓰는 오프라인 한국어 TTS 모델(sherpa-onnx VITS, KSS 데이터셋) 다운로드
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p models
if [ ! -d models/vits-mimic3-ko_KO-kss_low ]; then
  curl -sSL -o models/kss.tar.bz2 https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-mimic3-ko_KO-kss_low.tar.bz2
  tar xjf models/kss.tar.bz2 -C models && rm models/kss.tar.bz2
fi
echo "ok: models/vits-mimic3-ko_KO-kss_low"
