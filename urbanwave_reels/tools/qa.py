#!/usr/bin/env python3
"""검수 도구.

python3 tools/qa.py sheets <video.mp4> <outdir>
    씬마다 3프레임(30%/60%/끝 직전)을 뽑아 가림 영역 오버레이를 그린 시트 PNG 생성
python3 tools/qa.py zones <qa_video.mp4>
    배경(터널) 없이 렌더한 QA 영상에서, 모든 프레임의 금지 영역에 글자/요소가 있는지 검사
"""
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = json.load(open(os.path.join(ROOT, "src", "generated", "timing.json"), encoding="utf-8"))
W, H = 1080, 1920
SAFE_TOP, SAFE_BOTTOM, BR_X, BR_Y = 250, 1570, 900, 1100


def frame_at(video, n, scale=1.0):
    w, h = int(W * scale), int(H * scale)
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", video, "-vf", f"select=eq(n\\,{n}),scale={w}:{h}", "-vframes", "1",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    return Image.frombytes("RGB", (w, h), raw)


def overlay(img):
    im = img.convert("RGBA")
    ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    red = (255, 40, 40, 70)
    d.rectangle([0, 0, W, SAFE_TOP], fill=red)
    d.rectangle([0, SAFE_BOTTOM, W, H], fill=red)
    d.rectangle([BR_X, BR_Y, W, SAFE_BOTTOM], fill=(255, 160, 0, 80))
    return Image.alpha_composite(im, ov).convert("RGB")


def sheets(video, outdir):
    os.makedirs(outdir, exist_ok=True)
    for s in T["scenes"]:
        picks = [s["startFrame"] + int(s["frames"] * r) for r in (0.3, 0.6)] + [s["startFrame"] + s["frames"] - 2]
        tiles = [overlay(frame_at(video, n)).resize((540, 960)) for n in picks]
        sheet = Image.new("RGB", (540 * 3 + 20, 960), (60, 60, 60))
        for i, t in enumerate(tiles):
            sheet.paste(t, (i * 550, 0))
        p = os.path.join(outdir, f"{s['id']}_{s['key']}.png")
        sheet.save(p)
        print(p, picks)


def zones(video):
    """배경 없는 QA 렌더(0.5배)에서 금지 영역 픽셀 검사."""
    sc = 0.5
    w, h = int(W * sc), int(H * sc)
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-i", video, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                            stdout=subprocess.PIPE)
    bad = {}
    n = 0
    while True:
        buf = proc.stdout.read(w * h * 3)
        if len(buf) < w * h * 3:
            break
        a = np.frombuffer(buf, np.uint8).reshape(h, w, 3).astype(int)
        lum = a.max(axis=2)
        mask = lum > 60  # 배경 #161616 보다 확실히 밝은 픽셀
        top = mask[: int(SAFE_TOP * sc)].sum()
        bottom = mask[int(SAFE_BOTTOM * sc):].sum()
        br = mask[int(BR_Y * sc): int(SAFE_BOTTOM * sc), int(BR_X * sc):].sum()
        if top + bottom + br > 4:
            bad[n] = (int(top), int(bottom), int(br))
        n += 1
    proc.wait()
    print(f"검사 프레임 {n}개, 금지 영역 침범 프레임 {len(bad)}개")
    for k in list(bad)[:40]:
        sc_id = next(s["id"] for s in T["scenes"] if s["startFrame"] <= k < s["startFrame"] + s["frames"])
        print(f"  frame {k} ({sc_id}) top/bottom/우하단 = {bad[k]}")
    return len(bad)


if __name__ == "__main__":
    if sys.argv[1] == "sheets":
        sheets(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == "zones":
        sys.exit(1 if zones(sys.argv[2]) else 0)
