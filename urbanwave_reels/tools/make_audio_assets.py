#!/usr/bin/env python3
"""BGM·효과음을 코드로 직접 합성한다 (외부 샘플·음원 없음 → 저작권 문제 없음).

public/bgm/bgm_generated.wav : 128BPM 일렉트로닉 루프 (킥/클랩/햇/베이스/아르페지오)
public/sfx/*.wav            : whoosh(전환), thud(슬램), stamp(도장), pop(숫자 팝), tick(카운터)
"""
import os
import wave

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SR = 48000
rng = np.random.default_rng(7)


def save(path, x, peak=0.89):
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    x = x / (np.abs(x).max() + 1e-9) * peak
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())


def t(sec):
    return np.arange(int(SR * sec)) / SR


def lowpass(x, cutoff):
    """1-pole lowpass; cutoff may be an array (time-varying)."""
    cutoff = np.broadcast_to(np.asarray(cutoff, dtype=np.float64), x.shape)
    a = 1 - np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y


def env(n, attack, decay):
    tt = np.arange(n) / SR
    return np.minimum(tt / max(attack, 1e-4), 1) * np.exp(-tt / decay)


# ---------- SFX ----------
def whoosh():
    d = 0.42
    n = int(SR * d)
    noise = rng.standard_normal(n)
    sweep = np.linspace(400, 7000, n) ** 1.0
    sweep = np.concatenate([sweep[: n * 2 // 3], np.linspace(7000, 1500, n - n * 2 // 3)])
    x = lowpass(noise, sweep) - lowpass(noise, sweep * 0.25)
    shape = np.sin(np.linspace(0, np.pi, n)) ** 2
    return x * shape


def thud():
    tt = t(0.6)
    f = 42 + 110 * np.exp(-tt * 28)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 6)
    click = rng.standard_normal(len(tt)) * np.exp(-tt * 120) * 0.5
    return np.tanh((body + lowpass(click, 3000)) * 2.2)


def stamp():
    x = thud()
    tt = t(0.6)
    crack = lowpass(rng.standard_normal(len(tt)), 5000) * np.exp(-tt * 40)
    return x + crack * 0.8


def pop():
    tt = t(0.18)
    f = 900 + 900 * np.exp(-tt * 40)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(len(tt), 0.002, 0.05)


def tick():
    tt = t(0.06)
    return np.sin(2 * np.pi * 2400 * tt) * env(len(tt), 0.001, 0.012)


# ---------- BGM ----------
def bgm(seconds=40.0, bpm=128):
    beat = 60 / bpm
    n = int(SR * seconds)
    L = np.zeros(n)
    R = np.zeros(n)

    def add(sig, start, gain=1.0, pan=0.0):
        i = int(start * SR)
        if i >= n:
            return
        sig = sig[: n - i]
        L[i:i + len(sig)] += sig * gain * (1 - max(pan, 0))
        R[i:i + len(sig)] += sig * gain * (1 + min(pan, 0))

    kt = t(0.35)
    kick = np.sin(2 * np.pi * np.cumsum(45 + 140 * np.exp(-kt * 35)) / SR) * np.exp(-kt * 9)
    kick = np.tanh(kick * 1.8)
    ht = t(0.09)
    hat = lowpass(rng.standard_normal(len(ht)), 9000) - lowpass(rng.standard_normal(len(ht)), 4000)
    hat *= np.exp(-ht * 45)
    ct = t(0.25)
    clap = lowpass(rng.standard_normal(len(ct)), 3500) * np.exp(-ct * 22)

    # A minor: Am - F - C - G (1 bar each)
    roots = [45, 41, 48, 43]  # MIDI
    chords = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]]

    def hz(m):
        return 440 * 2 ** ((m - 69) / 12)

    def saw(f, d):
        tt = t(d)
        ph = (f * tt) % 1.0
        return 2 * ph - 1

    beats_total = int(seconds / beat) + 1
    for b in range(beats_total):
        s = b * beat
        bar = (b // 4) % 4
        intro = b < 2
        add(kick, s, 1.0)
        if b % 4 in (1, 3):
            add(clap, s, 0.45)
        add(hat, s + beat / 2, 0.35, pan=0.3)
        add(hat, s + beat / 4, 0.12, pan=-0.3)
        add(hat, s + 3 * beat / 4, 0.12, pan=-0.3)
        if intro:
            continue
        # offbeat bass
        bd = beat / 2 * 0.9
        bs = saw(hz(roots[bar]), bd)
        bs = lowpass(bs, 500 + 900 * np.exp(-t(bd) * 18)) * env(len(bs), 0.003, 0.12)
        add(bs, s + beat / 2, 0.9)
        # 16th arp pluck
        for k in range(4):
            note = chords[bar][(b * 4 + k) % 3] + 12
            pd = beat / 4
            pl = saw(hz(note), pd) * 0.6 + np.sin(2 * np.pi * hz(note) * t(pd))
            pl = lowpass(pl, 2600) * env(len(pl), 0.002, 0.05)
            add(pl, s + k * beat / 4, 0.18, pan=0.4 if k % 2 else -0.4)
    # pad (bar-long, soft)
    bar_len = beat * 4
    for bi in range(int(seconds / bar_len) + 1):
        ch = chords[bi % 4]
        pd = bar_len
        pad = sum(saw(hz(m), pd) + saw(hz(m) * 1.004, pd) for m in ch)
        pad = lowpass(pad, 1200) * np.minimum(t(pd) / 0.3, 1) * np.minimum((pd - t(pd)) / 0.3, 1)
        add(pad, bi * bar_len, 0.05)
    mix = np.stack([L, R], axis=1)
    fade = np.minimum(np.arange(n) / (SR * 0.02), 1) * np.minimum((n - np.arange(n)) / (SR * 1.5), 1)
    return np.tanh(mix * fade[:, None] * 0.9)


if __name__ == "__main__":
    sfx = os.path.join(ROOT, "public", "sfx")
    for name, fn in [("whoosh", whoosh), ("thud", thud), ("stamp", stamp), ("pop", pop), ("tick", tick)]:
        save(os.path.join(sfx, f"{name}.wav"), fn())
    save(os.path.join(ROOT, "public", "bgm", "bgm_generated.wav"), bgm(), peak=0.8)
    print("ok: public/sfx/*.wav, public/bgm/bgm_generated.wav")
