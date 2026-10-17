#!/usr/bin/env bash
# 힉스필드 Seed Audio(보이스 Leo, speech_rate +15)로 만든 씬별 음성을 voice_override/ 로 받는다.
# 받은 뒤 ./render.sh 를 실행하면 타이밍이 자동으로 다시 맞춰진다.
set -euo pipefail
cd "$(dirname "$0")/.."
B=https://d8j0ntlcm91z4.cloudfront.net/user_37s7yogeDHIHJ5nwAS5DFZlXC1T
while read -r n f; do
  curl -fsSL -o "voice_override/scene$n.wav" "$B/$f"
  echo "ok scene$n"
done <<'LIST'
01 hf_20261017_145654_04eab09e-095c-450f-bc57-bb7a33ff8684.wav
02 hf_20261017_144221_0130a81f-c13c-4277-809c-763cc5f56982.wav
03 hf_20261017_144221_aaa5ddb9-3b22-4a9d-ace2-91292ca8c379.wav
04 hf_20261017_144221_615d07e6-7c02-4fa8-8301-7ff735cec393.wav
05 hf_20261017_144250_9c0290c8-6942-481f-bb71-ef8ee7ddc140.wav
06 hf_20261017_145654_cda950c6-7d33-49e6-879b-b9b7668fd985.wav
07 hf_20261017_144221_99b4eada-7bdb-45dc-8c58-b7ef21cf471f.wav
08 hf_20261017_145654_e8811c12-7ac1-4ca1-8dcb-6b8797fcd6ed.wav
09 hf_20261017_144221_80d223d7-8e20-4239-a5d2-3c54a4a7cf37.wav
10 hf_20261017_144221_f951012e-3b10-4899-ae63-20efea12038d.wav
LIST
