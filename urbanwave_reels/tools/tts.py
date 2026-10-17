#!/usr/bin/env python3
"""씬별 TTS 생성 + 길이 측정 → src/generated/timing.json

우선순위 (씬마다):
  1. voice_override/sceneNN.(mp3|wav|m4a)  ← 직접 녹음/생성한 파일이 있으면 그대로 사용
  2. edge-tts (script.json voice.edge_voice)
  3. 오프라인 폴백: sherpa-onnx + Korean VITS (voice.fallback_model)

씬 길이 = 음성 길이 + padSec. 생성 음성이면 전체 길이가 targetSec 범위를
벗어날 때 속도를 자동 보정해 다시 만든다. (직접 넣은 파일은 건드리지 않고 경고만)
"""
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FPS = 30
SR = 48000
CACHE = os.path.join(ROOT, ".tts_cache")
OUT_AUDIO = os.path.join(ROOT, "public", "audio")
TIMING = os.path.join(ROOT, "src", "generated", "timing.json")


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def probe_duration(path):
    r = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path])
    return float(r.stdout.strip())


def edge_tts(text, voice, rate, pitch, out_mp3):
    cmd = [sys.executable, "-m", "edge_tts", "--voice", voice, f"--rate={rate}", f"--pitch={pitch}",
           "--text", text, "--write-media", out_mp3]
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if proxy:
        cmd += ["--proxy", proxy]
    subprocess.run(cmd, check=True, capture_output=True, timeout=60)
    if not os.path.exists(out_mp3) or os.path.getsize(out_mp3) < 1000:
        raise RuntimeError("edge-tts returned empty audio")


_fallback = {}
_edge_down = []


def fallback_tts(text, model_dir, speed, out_wav):
    import numpy as np
    import sherpa_onnx

    if model_dir not in _fallback:
        onnx = [f for f in os.listdir(model_dir) if f.endswith(".onnx")][0]
        cfg = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                    model=os.path.join(model_dir, onnx),
                    tokens=os.path.join(model_dir, "tokens.txt"),
                    data_dir=os.path.join(model_dir, "espeak-ng-data"),
                ),
                num_threads=4,
            )
        )
        _fallback[model_dir] = sherpa_onnx.OfflineTts(cfg)
    a = _fallback[model_dir].generate(text, sid=0, speed=speed)
    s = (np.clip(np.array(a.samples), -1, 1) * 32767).astype(np.int16)
    with wave.open(out_wav, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(a.sample_rate)
        w.writeframes(s.tobytes())


def normalize(src, dst):
    """48k mono, 앞뒤 무음 트림, 라우드니스 정규화."""
    trim = ("silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,"
            "areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06,areverse")
    run(["ffmpeg", "-y", "-v", "error", "-i", src, "-af",
         f"{trim},loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", str(SR), "-ac", "1", dst])


def sentence_beats(path, text, dur):
    """문장이 2개 이상이면 실제 쉼(silencedetect)에서 문장 시작 시각을 찾는다."""
    sents = [s for s in re.split(r"(?<=[.?!])\s+", text.strip()) if s]
    if len(sents) < 2:
        return [0.0]
    r = subprocess.run(["ffmpeg", "-v", "info", "-i", path, "-af", "silencedetect=noise=-35dB:d=0.1",
                        "-f", "null", "-"], capture_output=True, text=True)
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
    mids = [(s + e) / 2 for s, e in zip(starts, ends)]
    beats = [0.0]
    total_chars = sum(len(s) for s in sents)
    acc = 0
    for s in sents[:-1]:
        acc += len(s)
        est = dur * acc / total_chars
        cand = [m for m in mids if 0.3 < m < dur - 0.3]
        b = min(cand, key=lambda m: abs(m - est)) if cand and min(abs(m - est) for m in cand) < 0.8 else est
        beats.append(round(b, 3))
    return beats


def find_override(sid):
    for ext in ("mp3", "wav", "m4a", "aac", "ogg"):
        p = os.path.join(ROOT, "voice_override", f"{sid}.{ext}")
        if os.path.exists(p):
            return p
    return None


def synth(scene, voice, speed_scale, engine_pref):
    """씬 하나를 합성해 원본 파일 경로와 사용 엔진을 돌려준다(캐시 사용)."""
    text = scene["tts"]
    os.makedirs(CACHE, exist_ok=True)
    errors = []
    if engine_pref == "edge" or (engine_pref == "auto" and not _edge_down):
        base = int(voice["edge_rate"].replace("%", "").replace("+", ""))
        rate_pct = round((100 + base) * speed_scale - 100)
        rate = f"{rate_pct:+d}%"
        key = hashlib.sha1(f"edge|{voice['edge_voice']}|{rate}|{voice['edge_pitch']}|{text}".encode()).hexdigest()[:16]
        p = os.path.join(CACHE, f"{key}.mp3")
        if os.path.exists(p):
            return p, f"edge-tts {voice['edge_voice']} rate {rate}"
        try:
            edge_tts(text, voice["edge_voice"], rate, voice["edge_pitch"], p)
            return p, f"edge-tts {voice['edge_voice']} rate {rate}"
        except Exception as e:  # 네트워크 차단 등
            if os.path.exists(p):
                os.remove(p)
            if engine_pref == "edge":
                raise
            _edge_down.append(type(e).__name__)
            print(f"  edge-tts 접속 실패({type(e).__name__}) → 이번 실행은 오프라인 폴백 음성 사용")
    model = os.path.join(ROOT, voice["fallback_model"])
    if not os.path.isdir(model):
        raise SystemExit("\n".join(errors + [f"폴백 모델 없음: {model}  → tools/get_fallback_voice.sh 실행"]))
    speed = round(voice["fallback_speed"] * speed_scale, 3)
    key = hashlib.sha1(f"vits|{model}|{speed}|{text}".encode()).hexdigest()[:16]
    p = os.path.join(CACHE, f"{key}.wav")
    if not os.path.exists(p):
        fallback_tts(text, model, speed, p)
    return p, f"sherpa-onnx VITS {os.path.basename(model)} speed {speed}"


def build(cfg, speed_scale):
    os.makedirs(OUT_AUDIO, exist_ok=True)
    scenes = []
    frame = 0
    pad = cfg["padSec"]
    for i, sc in enumerate(cfg["scenes"]):
        override = find_override(sc["id"])
        if override:
            src, engine = override, f"override {os.path.relpath(override, ROOT)}"
        else:
            src, engine = synth(sc, cfg["voice"], speed_scale, cfg["voice"].get("engine", "auto"))
        dst = os.path.join(OUT_AUDIO, f"{sc['id']}.wav")
        normalize(src, dst)
        dur = probe_duration(dst)
        extra = cfg.get("outroHoldSec", 0) if i == len(cfg["scenes"]) - 1 else 0
        frames = math.ceil((dur + pad + extra) * FPS)
        scenes.append({
            "id": sc["id"], "key": sc["key"], "caption": sc["caption"], "tts": sc["tts"],
            "audio": f"audio/{sc['id']}.wav", "audioSec": round(dur, 3),
            "startFrame": frame, "frames": frames, "beats": sentence_beats(dst, sc["tts"], dur),
            "engine": engine, "override": bool(override),
        })
        frame += frames
    return {"fps": FPS, "width": 1080, "height": 1920, "totalFrames": frame, "scenes": scenes}


def main():
    cfg = json.load(open(os.path.join(ROOT, "script.json"), encoding="utf-8"))
    lo, hi = cfg["targetSec"]
    scale = 1.0
    for attempt in range(4):
        t = build(cfg, scale)
        total = t["totalFrames"] / FPS
        generated = [s for s in t["scenes"] if not s["override"]]
        if lo <= total <= hi or not generated:
            break
        target = hi - 0.5 if total > hi else lo + 0.5
        fixed = sum(s["frames"] for s in t["scenes"] if s["override"]) / FPS
        gen_audio = sum(s["audioSec"] for s in generated)
        gen_other = total - fixed - gen_audio
        need = target - fixed - gen_other
        if need <= 0:
            break
        scale *= gen_audio / need
        print(f"  총 {total:.2f}s → 범위 {lo}-{hi}s 밖. 생성 음성 속도 x{scale:.3f}로 재생성")
    t["speedScale"] = round(scale, 3)
    os.makedirs(os.path.dirname(TIMING), exist_ok=True)
    json.dump(t, open(TIMING, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    for s in t["scenes"]:
        print(f"  {s['id']} {s['audioSec']:5.2f}s  frames {s['frames']:3d}  beats {s['beats']}  [{s['engine']}]")
    total = t["totalFrames"] / FPS
    print(f"총 길이 {total:.2f}s ({t['totalFrames']} frames)")
    if not lo <= total <= hi:
        print(f"경고: 총 길이가 {lo}-{hi}s 범위를 벗어났습니다.")


if __name__ == "__main__":
    main()
