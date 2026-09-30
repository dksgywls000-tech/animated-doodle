"""Original 144 BPM soundtrack + SFX, synced to the cue sheet exported by the renderer.

usage: python3 tools/make_audio.py out/cues.json out/audio.wav
"""
import json, sys
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile

SR, DUR, BPM = 48000, 25.0, 144
B = 60 / BPM
N = int(SR * DUR)
rng = np.random.default_rng(7)
L = np.zeros(N); R = np.zeros(N)


def t_(d): return np.arange(int(SR * d)) / SR
def bp(x, lo, hi, o=2): return sosfilt(butter(o, [lo, hi], 'band', fs=SR, output='sos'), x)
def hp(x, f, o=2): return sosfilt(butter(o, f, 'high', fs=SR, output='sos'), x)
def lp(x, f, o=2): return sosfilt(butter(o, f, 'low', fs=SR, output='sos'), x)
def noise(d): return rng.uniform(-1, 1, int(SR * d))


def put(x, t, g=1.0, pan=0.0):
    i = int(t * SR)
    if i >= N or i + len(x) <= 0: return
    if i < 0: x, i = x[-i:], 0
    x = x[:N - i]
    L[i:i + len(x)] += x * g * np.sqrt(0.5 * (1 - pan))
    R[i:i + len(x)] += x * g * np.sqrt(0.5 * (1 + pan))


# ---------- instruments ----------
def kick(g=1.0):
    t = t_(0.45)
    f = 45 + 130 * np.exp(-t * 28)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7.5)
    x += lp(noise(0.45), 3000) * np.exp(-t * 120) * 0.35
    return np.tanh(x * 1.6) * g

def clap():
    x = np.zeros(int(SR * 0.3))
    for k, off in enumerate((0, 0.011, 0.022)):
        n = bp(noise(0.3), 900, 3200) * np.exp(-t_(0.3) * (80 if k < 2 else 16))
        s = int(off * SR); x[s:] += n[:len(x) - s]
    return x * 0.9

def hat(open_=False):
    d = 0.18 if open_ else 0.045
    return hp(noise(d), 7000, 4) * np.exp(-t_(d) * (18 if open_ else 90))

def bass(freq, d):
    t = t_(d)
    x = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * freq * 2 * t)
    x = np.tanh(x * 2.2) * np.minimum(1, t * 400) * np.exp(-t * 6)
    return lp(x, 900)

def impact(s=1.0):
    t = t_(1.6)
    f = 30 + 60 * np.exp(-t * 6)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 3.2)
    crack = lp(noise(1.6), 5000) * np.exp(-t * 22)
    tail = bp(noise(1.6), 200, 2500) * np.exp(-t * 3.5) * 0.18
    return np.tanh((boom * 1.2 + crack * 0.8 + tail) * 1.3) * s

def beep(f=2900, d=0.07):
    t = t_(d)
    return np.sign(np.sin(2 * np.pi * f * t)) * 0.25 * np.minimum(1, np.minimum(t, d - t) * 800)

def whoosh(d=0.35, up=True):
    t = t_(d); x = noise(d); out = np.zeros_like(x)
    steps = 24
    for k in range(steps):
        a, b_ = int(k * len(x) / steps), int((k + 1) * len(x) / steps)
        p = k / steps if up else 1 - k / steps
        fc = 300 + p ** 2 * 6000
        out[a:b_] = bp(x, fc * 0.7, min(fc * 1.4, 20000))[a:b_]
    env = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 2 if not up else (t / d) ** 2
    return out * env * 1.4

def riser(d=1.0):
    t = t_(d)
    tone = np.sin(2 * np.pi * np.cumsum(200 + 1400 * (t / d) ** 2) / SR) * 0.2
    return (whoosh(d, True) * 0.8 + tone) * (t / d) ** 1.5

def tick(f=4500, d=0.012, g=0.6):
    return bp(noise(d), f * 0.7, min(f * 1.4, 20000)) * np.exp(-t_(d) * 300) * g

def printer():
    x = np.zeros(int(SR * 0.2))
    for k in range(18):
        s = int(k * 0.0095 * SR); c = tick(2200 + (k % 3) * 400, 0.008, 0.9); x[s:s + len(c)] += c[:len(x) - s]
    return x + lp(noise(0.2), 400) * 0.15

def pop():
    t = t_(0.14)
    return np.sin(2 * np.pi * np.cumsum(500 + 1600 * t / 0.14) / SR) * np.exp(-t * 25) * 0.5

def sparkle():
    x = np.zeros(int(SR * 0.9))
    for k, f in enumerate((2637, 3136, 3951, 5274)):
        t = t_(0.5); s = int(k * 0.06 * SR); n = np.sin(2 * np.pi * f * t) * np.exp(-t * 9) * 0.18
        x[s:s + len(n)] += n
    return x


# ---------- music ----------
PROG = [55.0, 55.0, 43.65, 49.0]  # A1 A1 F1 G1, two bars each
nbeats = int(DUR / B) + 1
for i in range(nbeats):
    tb = i * B
    if 22.1 <= tb < 22.9: continue            # hold for the finish-line tension
    sec = 0 if tb < 5 else 1 if tb < 10 else 2
    put(kick(1.0), tb, 0.95)
    if sec >= 1 and i % 2 == 1: put(clap(), tb, 0.55, 0.05)
    put(hat(open_=True), tb + B / 2, 0.22, 0.3)
    if sec >= 2 or tb >= 15:
        for s in (1, 3): put(hat(), tb + s * B / 4, 0.16, -0.3)
    root = PROG[(i // 8) % 4]
    for s in (1, 2, 3):
        put(bass(root * (2 if (s == 3 and sec == 2) else 1), B / 4 * 0.95), tb + s * B / 4, 0.42)

# dark pad drone (A minor), ducked by the kick
t = np.arange(N) / SR
pad = sum(np.sin(2 * np.pi * f * t + rng.uniform(0, 6)) * 0.06 for f in (110, 110.6, 130.8, 164.8, 220.3))
pad = lp(pad, 1200) * np.minimum(1, t / 1.5)
duck = 1 - 0.7 * np.exp(-((t % B)) * 14)
L += pad * duck; R += pad * duck

# ---------- SFX from cue sheet ----------
cues = json.load(open(sys.argv[1]))
for c in cues:
    tt, ty, v = c['t'], c['type'], c.get('v', 1)
    if ty == 'impact': put(impact(min(1.2, v)), tt, 0.75)
    elif ty == 'lap': put(beep(), tt, 1); put(beep(), tt + 0.11, 1)
    elif ty == 'finishbeep': put(beep(2900, 0.4), tt - 0.3, 0.9)
    elif ty == 'whoosh': put(whoosh(0.28, True), tt - 0.06, 0.55)
    elif ty == 'swipe': put(whoosh(0.3, False), tt - 0.02, 0.6, 0.4)
    elif ty == 'sparkle': put(sparkle(), tt, 1, 0.2)
    elif ty == 'slot': put(tick(3000, 0.02, 0.8), tt, 0.9)
    elif ty == 'thud': put(kick(0.8), tt, 0.7)
    elif ty == 'riser_short': put(riser(0.6), tt, 0.35)
    elif ty == 'print': put(printer(), tt, 0.7, 0.1)
    elif ty == 'stamp': put(impact(1.1), tt, 0.8); put(clap(), tt, 0.9)
    elif ty == 'tap': put(tick(3500, 0.015, 1.0), tt, 0.8)
    elif ty == 'pop': put(pop(), tt, 0.9)
    elif ty == 'key': put(tick(5200, 0.01, 0.6), tt, 0.5, rng.uniform(-.3, .3))
    elif ty == 'send': put(whoosh(0.22, True), tt, 0.5)
    elif ty == 'count': put(tick(2600, 0.02, 0.7), tt, 0.6)
    elif ty == 'riser': put(riser(1.3), tt - 0.4, 0.8)
    elif ty == 'snap': put(impact(1.3), tt, 0.9); put(hp(noise(0.12), 2000) * np.exp(-t_(0.12) * 40), tt, 0.8)

# ---------- master: small room reverb, glue, limiter ----------
ir = rng.uniform(-1, 1, int(SR * 0.9)) * np.exp(-np.arange(int(SR * 0.9)) / SR * 7)
ir = lp(ir, 5000)
wetL = fftconvolve(L, ir)[:N] * 0.018; wetR = fftconvolve(R, ir[::-1].copy())[:N] * 0.018
L += wetL; R += wetR
mix = np.stack([L, R], 1)
mix = hp(mix.T, 25).T
mix = np.tanh(mix * 1.25) / np.tanh(1.25)
mix *= 0.89 / np.max(np.abs(mix))
fade = np.ones(N); fade[-int(SR * 0.03):] = np.linspace(1, 0, int(SR * 0.03))
mix *= fade[:, None]
wavfile.write(sys.argv[2], SR, (mix * 32767).astype(np.int16))
print('wrote', sys.argv[2])
