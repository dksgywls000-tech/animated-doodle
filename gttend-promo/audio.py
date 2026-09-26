"""GRACE TEN promo soundtrack — synthesized from scratch (120 BPM, 25s).

Every hit is placed on the same beat grid the visuals use (beat = 0.5s),
so cuts, slams and checks land exactly on the music.
"""
import numpy as np
import wave

SR = 44100
DUR = 25.0
N = int(SR * DUR)
BEAT = 0.5
rng = np.random.default_rng(7)

dry = np.zeros((N, 2))
send = np.zeros((N, 2))  # reverb bus


def place(buf, sig, t, gain=1.0, pan=0.0):
    i = int(round(t * SR))
    if i >= N:
        return
    if sig.ndim == 1:
        l = np.sqrt(0.5 * (1 - pan))
        r = np.sqrt(0.5 * (1 + pan))
        sig = np.stack([sig * l, sig * r], axis=1) * np.sqrt(2)
    sig = sig[: N - i]
    buf[i : i + len(sig)] += sig * gain


def tt(d):
    return np.arange(int(d * SR)) / SR


def band(x, lo=None, hi=None, soft=0.15):
    """FFT band filter with soft edges (fine for short one-shots)."""
    n = len(x)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    g = np.ones_like(f)
    if lo:
        g *= 1 / (1 + (lo / np.maximum(f, 1)) ** 4)
    if hi:
        g *= 1 / (1 + (f / hi) ** 4)
    return np.fft.irfft(X * g, n)


def kick(big=False):
    t = tt(0.55 if big else 0.38)
    f = 45 + 120 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * (5 if big else 8))
    click = band(rng.standard_normal(len(t)), 2000, 9000) * np.exp(-t * 300) * 0.5
    return np.tanh((body + click) * 1.6) * 0.9


def clap():
    t = tt(0.3)
    n = band(rng.standard_normal(len(t)), 900, 5000)
    env = np.zeros_like(t)
    for o in (0, 0.011, 0.022):
        env += (t >= o) * np.exp(-np.maximum(t - o, 0) * (60 if o < 0.02 else 14))
    return n * env * 0.55


def snare():
    t = tt(0.22)
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30)
    n = band(rng.standard_normal(len(t)), 1500, 8000) * np.exp(-t * 22)
    return (tone * 0.5 + n * 0.6) * 0.7


def hat(open_=False):
    t = tt(0.25 if open_ else 0.06)
    n = band(rng.standard_normal(len(t)), 7000, None)
    return n * np.exp(-t * (14 if open_ else 70)) * 0.22


def bass_note(freq, d=0.24):
    t = tt(d)
    saw = sum(np.sin(2 * np.pi * freq * k * t) / k for k in range(1, 9))
    env = np.minimum(t / 0.004, 1) * np.exp(-t * 7)
    sub = np.sin(2 * np.pi * freq / 2 * t) * np.minimum(t / 0.004, 1) * np.exp(-t * 4)
    return band(saw, None, 420) * env * 0.35 + sub * 0.45


def stab(freqs, d=1.2):
    t = tt(d)
    s = np.zeros_like(t)
    for fr in freqs:
        for det in (-0.12, 0, 0.13):
            ph = 2 * np.pi * fr * (1 + det / 100) * t
            s += 2 * (ph / (2 * np.pi) % 1) - 1
    s = band(s, 120, 3200) / (len(freqs) * 3)
    return s * np.exp(-t * 3.2) * 0.9


def impact():
    t = tt(2.2)
    f = 28 + 60 * np.exp(-t * 6)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.2)
    crack = band(rng.standard_normal(len(t)), 300, 12000) * np.exp(-t * 9)
    return np.tanh(boom * 1.8) * 0.9 + crack * 0.5


def ping(freq=2093):
    t = tt(0.9)
    s = np.sin(2 * np.pi * freq * t) + 0.4 * np.sin(2 * np.pi * freq * 1.5 * t) + 0.2 * np.sin(2 * np.pi * freq * 2.76 * t)
    return s * np.exp(-t * 6) * np.minimum(t / 0.002, 1) * 0.16


def whoosh(d=0.45):
    t = tt(d)
    x = t / d
    env = np.sin(np.pi * x) ** 2
    lo = band(rng.standard_normal(len(t)), 400, 2500)
    hi = band(rng.standard_normal(len(t)), 2500, 9000)
    return (lo * (1 - x) + hi * x) * env * 0.35


def riser(d):
    t = tt(d)
    x = t / d
    f = 180 * (12 ** x)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.12
    n = rng.standard_normal(len(t))
    nh = band(n, 3000, None)
    nl = band(n, 300, 3000)
    noise = (nl * (1 - x) + nh * x) * 0.35
    return (tone + noise) * x ** 2.2


def tick():
    t = tt(0.05)
    return np.sin(2 * np.pi * 3200 * t) * np.exp(-t * 120) * 0.25


def drone(d):
    t = tt(d)
    s = np.sin(2 * np.pi * 43.65 * t) * 0.35 + np.sin(2 * np.pi * 87.3 * t + np.sin(t * 2)) * 0.12
    return s * np.minimum(t / 0.6, 1)


# ---------------------------------------------------------------- arrangement
ROOTS = [87.31, 69.30, 103.83, 77.78]
CHORD = [174.61, 207.65, 261.63, 349.23]  # F minor stab

# intro
place(dry, drone(2.2) * np.linspace(1, 0.4, int(2.2 * SR)), 0.0, 0.8)
for i, t0 in enumerate((0.10, 0.30, 0.50)):
    place(dry, ping([1567.98, 2093.0, 2637.0][i]), t0, 1.0, [-0.5, 0, 0.5][i])
    place(send, ping([1567.98, 2093.0, 2637.0][i]), t0, 0.9)
place(dry, riser(1.1), 0.9, 0.9)
place(dry, whoosh(0.3), 1.75, 1.0)

HITS = [4.5, 18.5, 23.5]
DROP = (18.25, 18.5)
HALF = (20.0, 21.5)
END = 23.5

beats = np.arange(2.0, END, BEAT)
for b in beats:
    if DROP[0] <= b < DROP[1]:
        continue
    k_on = True
    if HALF[0] <= b < HALF[1] and int(round((b - HALF[0]) / BEAT)) % 2 == 1:
        k_on = False
    if k_on:
        place(dry, kick(big=b in HITS), b, 1.0)
    bar_pos = int(round((b - 2.0) / BEAT)) % 4
    if b >= 4.5 and bar_pos in (1, 3) and not (HALF[0] <= b < HALF[1] and bar_pos == 1):
        place(dry, clap(), b, 0.9)
        place(send, clap(), b, 0.5)
    # hats
    step = 0.125 if (7.5 <= b < 18.0 or 21.5 <= b < END) else 0.25
    for s in np.arange(0, BEAT, step):
        tt0 = b + s
        if tt0 >= END or DROP[0] <= tt0 < DROP[1]:
            continue
        acc = 1.0 if abs(s - 0.25) < 1e-6 else 0.6
        place(dry, hat(open_=abs(s - 0.25) < 1e-6 and b >= 4.5), tt0, acc, 0.3)
    # bass on 8th offbeats + downbeat
    root = ROOTS[int((b - 2.0) // 2.0) % 4]
    if b >= 2.0 and not (HALF[0] <= b < HALF[1]):
        place(dry, bass_note(root / 2), b + 0.25, 0.9)
        if b >= 4.5:
            place(dry, bass_note(root / 2, 0.2), b, 0.6)
    elif HALF[0] <= b < HALF[1]:
        place(dry, bass_note(root / 2, 0.45), b, 0.7)

# drum fill into the drop
for s in np.arange(17.5, 18.25, 0.0625):
    place(dry, snare(), s, 0.25 + 0.75 * (s - 17.5) / 0.75)
place(dry, riser(1.3), 16.95, 1.0)
place(dry, riser(1.0), 22.5, 0.9)
place(dry, riser(0.9), 3.6, 0.6)

# hits / stabs
for h in HITS:
    place(dry, impact(), h, 0.9)
    place(send, impact(), h, 0.6)
    place(dry, stab(CHORD, 1.6), h, 0.8)
    place(send, stab(CHORD, 1.6), h, 0.8)
for s in (7.5, 9.5, 15.5):
    place(dry, stab(CHORD, 0.7), s, 0.55)
    place(send, stab(CHORD, 0.7), s, 0.5)

# whooshes on transitions
for w in (4.2, 7.2, 9.2, 10.3, 11.3, 12.3, 13.3, 14.3, 15.25, 16.3, 17.3, 19.8, 21.3):
    place(dry, whoosh(0.35), w, 0.9)

# word slams 2.0-4.0 : extra snap
for b in (2.0, 2.5, 3.0, 3.5):
    place(dry, snare(), b, 0.35)
place(dry, snare(), 4.0, 0.5)

# check ticks (station check bar fills)
checks = [(9.55, 4), (10.55, 1), (11.55, 1), (12.55, 2), (13.55, 2)]
for t0, n in checks:
    for i in range(n):
        place(dry, tick(), t0 + i * 0.07, 1.0)
for i in range(10):
    place(dry, tick(), 18.5 + i * 0.05, 0.8)
    place(dry, tick(), 14.55 + i * 0.04, 0.5)

# end card sparkle
for i, t0 in enumerate((23.6, 23.75, 23.9)):
    place(dry, ping([2093.0, 2637.0, 3135.96][i]), t0, 1.0, [-0.5, 0, 0.5][i])
    place(send, ping([2093.0, 2637.0, 3135.96][i]), t0, 1.2)

# --------------------------------------------------------------- reverb + mix
ir_t = tt(1.6)
ir = rng.standard_normal((len(ir_t), 2)) * np.exp(-ir_t * 3.5)[:, None]
ir = np.stack([band(ir[:, 0], 250, 6000), band(ir[:, 1], 250, 6000)], axis=1)
L = N + len(ir_t)
nfft = 1 << (L - 1).bit_length()
wet = np.zeros((N, 2))
for c in range(2):
    wet[:, c] = np.fft.irfft(np.fft.rfft(send[:, c], nfft) * np.fft.rfft(ir[:, c], nfft), nfft)[:N]
wet /= np.max(np.abs(wet)) + 1e-9

mix = dry + wet * 0.22
# sidechain-ish pump from kicks
pump = np.ones(N)
for b in beats:
    if DROP[0] <= b < DROP[1]:
        continue
    i = int(b * SR)
    d = int(0.22 * SR)
    seg = pump[i : i + d]
    seg *= 1 - 0.35 * np.exp(-np.arange(len(seg)) / SR * 14)
mix *= pump[:, None] ** 0.5
# hard silence for the drop gap (keeps riser cut crisp)
g0, g1 = int(DROP[0] * SR), int(DROP[1] * SR)
mix[g0:g1] *= np.linspace(0.15, 0.0, g1 - g0)[:, None]
# fades
fo = int(0.6 * SR)
mix[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 2
mix[: int(0.01 * SR)] *= np.linspace(0, 1, int(0.01 * SR))[:, None]

mix = np.tanh(mix * 1.2)
mix = mix / np.max(np.abs(mix)) * 0.89

with wave.open("build/audio.wav", "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print("audio ok", mix.shape)
