#!/usr/bin/env python3
"""timing.json → out/srt/urbanwave_reels.srt (씬 자막을 음성 구간에 맞춰 표시)"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = json.load(open(os.path.join(ROOT, "src", "generated", "timing.json"), encoding="utf-8"))


def plain(cap):
    cap = re.sub(r"~~([^~]+)~~\s*(→\s*)?", r"\1 → ", cap)  # ~~4랩~~ 6랩 → "4랩 → 6랩"
    cap = cap.replace("**", "")
    return re.sub(r"\s+", " ", cap).strip()


def ts(sec):
    ms = int(round(sec * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "out", "srt", "urbanwave_reels.srt")
os.makedirs(os.path.dirname(out), exist_ok=True)
fps = T["fps"]
lines = []
for i, s in enumerate(T["scenes"], 1):
    start = s["startFrame"] / fps
    end = (s["startFrame"] + s["frames"]) / fps - 0.04
    lines += [str(i), f"{ts(start)} --> {ts(end)}", plain(s["caption"]), ""]
open(out, "w", encoding="utf-8").write("\n".join(lines))
print("ok:", os.path.relpath(out, ROOT))
