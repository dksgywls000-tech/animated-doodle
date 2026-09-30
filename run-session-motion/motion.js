/* FREEDOM × GTTEND RUN SESSION — 25s motion graphic.
 *
 * Everything is a pure function of time: renderFrame(f) draws frame f, so the
 * Playwright renderer can step through it deterministically. The concept is
 * "25 seconds = 5 km": a running-watch HUD counts 0.00 → 5.00 KM and every
 * 5 s (1 km) a lap beep moves the story to the next chapter.
 */
(() => {
const W = 1080, H = 1920, FPS = 30, DUR = 25;
const BPM = 144, B = 60 / BPM;              // one beat = 0.4167 s, 12 beats per km
const Q = new URLSearchParams(location.search);
const DDAY = Q.get('dday') || '';           // e.g. "D-3" adds a badge on the deadline card
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');

// ---------- math ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, p) => a + (b - a) * p;
const outExpo = p => p >= 1 ? 1 : 1 - Math.pow(2, -10 * p);
const inExpo = p => p <= 0 ? 0 : Math.pow(2, 10 * p - 10);
const outCubic = p => 1 - Math.pow(1 - p, 3);
const inOut = p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
const outBack = p => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };
const rnd = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// ---------- fonts ----------
const F = {
  anton: s => `400 ${s}px Anton`,
  kr: (w, s) => `${w} ${s}px Pretendard`,
  mono: (w, s) => `${w} ${s}px JBM`,
};

// ---------- timeline (seconds) ----------
const T = {
  hook: 0, dom: 1.25, lock: 1.67, title: 2.08,
  km1: 5, date: 5, place: 6.67, run: 8.33,
  km2: 10, rcpt: 10,
  km3: 15, steps: [15, 16.25, 17.5, 18.75],
  km4: 20, only: 20, dead: 21.25, tape: 22.5, finish: 22.92, end: 25,
};
const IMPACTS = [
  [0, 1], [T.dom, .7], [T.lock, .6], [T.title, 1], [T.title + 2 * B, .7], [T.km1, .8], [T.place, .7], [T.run, .7],
  [T.km2, .9], [13.75, 1.2], [T.km3, .8], [T.km4, 1], [T.dead, 1], [T.finish, 1.4],
];

// ---------- assets ----------
const IMG = {};
const CLIPS = {};
function loadImg(key, src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => { IMG[key] = i; res(); }; i.onerror = rej; i.src = src; });
}
async function loadClip(name) {
  // Optional AI (Higgsfield) footage, pre-extracted to frames. Missing = photo fallback.
  try {
    const r = await fetch(`assets/gen/clips/${name}/manifest.json`);
    if (!r.ok) return;
    const m = await r.json();
    CLIPS[name] = { ...m, cache: new Map() };
  } catch (e) { /* no clip */ }
}
async function clipFrame(name, t) {
  const c = CLIPS[name];
  if (!c) return null;
  const i = clamp(Math.floor(t * c.fps), 0, c.frames - 1);
  if (c.cache.has(i)) return c.cache.get(i);
  const img = new Image();
  img.src = `assets/gen/clips/${name}/${String(i + 1).padStart(4, '0')}.jpg`;
  await img.decode();
  if (c.cache.size > 12) c.cache.delete(c.cache.keys().next().value);
  c.cache.set(i, img);
  return img;
}

async function load() {
  const faces = [
    ['Anton', 'assets/fonts/Anton.ttf', '400'],
    ['JBM', 'assets/fonts/JBMono-500.ttf', '500'],
    ['JBM', 'assets/fonts/JBMono-800.ttf', '800'],
    ['Pretendard', 'assets/fonts/Pretendard-SemiBold.woff2', '600'],
    ['Pretendard', 'assets/fonts/Pretendard-Bold.woff2', '700'],
    ['Pretendard', 'assets/fonts/Pretendard-ExtraBold.woff2', '800'],
    ['Pretendard', 'assets/fonts/Pretendard-Black.woff2', '900'],
  ];
  await Promise.all(faces.map(async ([fam, url, w]) => {
    const f = new FontFace(fam, `url(${url})`, { weight: w });
    await f.load(); document.fonts.add(f);
  }));
  await Promise.all([
    loadImg('photo', 'assets/photo_clean.jpg'),
    loadImg('poster', 'assets/poster.jpg'),
    loadImg('plate', 'assets/gen/bg_plate.jpg'),
    loadImg('people', 'assets/gen/people.png'),
    loadImg('runL', 'assets/gen/runner_left.png'),
    loadImg('runR', 'assets/gen/runner_right.png'),
    ...['freedom', 'gttend', 'gttend_stars', 'gttend_word'].flatMap(n => [
      loadImg(n + '_w', `assets/gen/${n}_w.svg`), loadImg(n + '_k', `assets/gen/${n}_k.svg`)]),
    loadClip('hero'), loadClip('face'), loadClip('legs'),
  ]);
  makeGrain();
  makeStamp();
}

// ---------- drawing helpers ----------
function text(s, x, y, o = {}) {
  ctx.save();
  ctx.font = o.font;
  ctx.textAlign = o.align || 'center';
  ctx.textBaseline = o.base || 'alphabetic';
  ctx.letterSpacing = (o.ls || 0) + 'px';
  if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
  ctx.translate(x, y);
  if (o.scale) ctx.scale(o.scale, o.scale);
  if (o.skew) ctx.transform(1, 0, -o.skew, 1, 0, 0);
  if (o.stroke) { ctx.lineWidth = o.stroke; ctx.strokeStyle = o.color || '#fff'; ctx.lineJoin = 'round'; ctx.strokeText(s, 0, 0); }
  else { ctx.fillStyle = o.color || '#fff'; ctx.fillText(s, 0, 0); }
  ctx.restore();
}
function measure(s, font, ls = 0) { ctx.save(); ctx.font = font; ctx.letterSpacing = ls + 'px'; const w = ctx.measureText(s).width; ctx.restore(); return w; }
function echo(n, dx, dy, a, fn) {
  for (let i = n; i >= 1; i--) { ctx.save(); ctx.globalAlpha *= a * (1 - i / (n + 1)); ctx.translate(dx * i, dy * i); fn(); ctx.restore(); }
  fn();
}
// content slides up into a horizontal band [top, bottom]
function rise(p, top, bottom, fn) {
  if (p <= 0) return;
  ctx.save(); ctx.beginPath(); ctx.rect(-50, top, W + 100, bottom - top); ctx.clip();
  ctx.translate(0, (1 - outExpo(p)) * (bottom - top)); fn(); ctx.restore();
}
function rrect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function svg(key, x, y, w, anchor = 'c') {
  const im = IMG[key]; const h = w * im.naturalHeight / im.naturalWidth;
  const ox = anchor.includes('l') ? 0 : anchor.includes('r') ? w : w / 2;
  ctx.drawImage(im, x - ox, y - h / 2, w, h); return h;
}
function cover(img, zoom = 1, fx = .5, fy = .5) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.max(W / iw, H / ih) * zoom, dw = iw * s, dh = ih * s;
  const ox = clamp(W / 2 - fx * dw, W - dw, 0), oy = clamp(H / 2 - fy * dh, H - dh, 0);
  return { ox, oy, dw, dh };
}
function drawT(img, T0, a = 1) { ctx.save(); ctx.globalAlpha *= a; ctx.drawImage(img, T0.ox, T0.oy, T0.dw, T0.dh); ctx.restore(); }
function dim(a, col = '0,0,0') { ctx.fillStyle = `rgba(${col},${a})`; ctx.fillRect(0, 0, W, H); }
function vgrad(y0, y1, a0, a1) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, `rgba(0,0,0,${a0})`); g.addColorStop(1, `rgba(0,0,0,${a1})`);
  ctx.fillStyle = g; ctx.fillRect(0, y0, W, y1 - y0);
}
function speedLines(t, a = .5, n = 46, speed = 2600, seed = 0, y0 = 0, y1 = H) {
  ctx.save();
  for (let i = 0; i < n; i++) {
    const r1 = rnd(i + seed * 91), r2 = rnd(i * 3.1 + seed), r3 = rnd(i * 7.7 + seed * 3);
    const y = y0 + r1 * (y1 - y0), len = 180 + r2 * 1000, sp = speed * (.45 + r3);
    const span = W + len * 2;
    const x = W + len - ((t * sp + r2 * 9000) % span) - len;
    const g = ctx.createLinearGradient(x, 0, x + len, 0);
    const al = a * (.25 + .75 * r3);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.15, `rgba(255,255,255,${al})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y, len, 1 + r3 * 3.5);
  }
  ctx.restore();
}
function starPath(cx, cy, r, rot = 0, k = .16) {
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = rot + i * Math.PI / 2, b = a + Math.PI / 2, m = a + Math.PI / 4;
    if (i === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.quadraticCurveTo(cx + Math.cos(m) * r * k, cy + Math.sin(m) * r * k, cx + Math.cos(b) * r, cy + Math.sin(b) * r);
  }
  ctx.closePath();
}
function sparkle(cx, cy, r, a = 1, rot = 0) { ctx.save(); ctx.globalAlpha *= a; ctx.fillStyle = '#fff'; starPath(cx, cy, r, rot - Math.PI / 2); ctx.fill(); ctx.restore(); }

// ---------- grain / stamp textures ----------
const GRAIN = [];
function makeGrain() {
  for (let k = 0; k < 8; k++) {
    const c = document.createElement('canvas'); c.width = 540; c.height = 960;
    const g = c.getContext('2d'), d = g.createImageData(540, 960);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = 128 + (Math.random() + Math.random() + Math.random() - 1.5) * 150;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255;
    }
    g.putImageData(d, 0, 0); GRAIN.push(c);
  }
}
let STAMP;
function makeStamp() {
  const c = document.createElement('canvas'); c.width = 620; c.height = 300;
  const g = c.getContext('2d');
  g.strokeStyle = '#000'; g.lineWidth = 16; g.beginPath(); g.roundRect(14, 14, 592, 272, 30); g.stroke();
  g.lineWidth = 5; g.beginPath(); g.roundRect(36, 36, 548, 228, 18); g.stroke();
  g.fillStyle = '#000'; g.font = F.anton(210); g.textAlign = 'center'; g.textBaseline = 'middle'; g.letterSpacing = '10px';
  g.fillText('FREE', 318, 158);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 2600; i++) { g.globalAlpha = Math.random() * .9; g.beginPath(); g.arc(Math.random() * 620, Math.random() * 300, Math.random() * 3.2, 0, 7); g.fill(); }
  STAMP = c;
}

// ---------- global FX ----------
function impactEnv(t, k = 9) {
  let v = 0;
  for (const [ti, s] of IMPACTS) if (t >= ti && t < ti + .8) v += s * Math.exp(-(t - ti) * k);
  return v;
}
function shakeOffset(t) {
  const e = impactEnv(t, 11);
  return [(rnd(Math.floor(t * 60)) - .5) * 34 * e, (rnd(Math.floor(t * 60) + 7) - .5) * 34 * e];
}

// ---------- HUD (running watch) ----------
function hud(t) {
  if (t >= T.tape && t < T.finish + .1) return;
  const km = Math.min(t / 5, 5);
  const lap = [5, 10, 15, 20, 25].find(x => t >= x - .02 && t < x + .55);
  const y = 238;
  ctx.save();
  const blink = Math.floor(t * 2) % 2 === 0;
  ctx.fillStyle = '#fff'; ctx.globalAlpha = blink ? 1 : .35; ctx.beginPath(); ctx.arc(76, y - 11, 9, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  text('RUN SESSION 01', 98, y, { font: F.mono(800, 26), align: 'left', ls: 3 });
  const label = t >= 24.9 ? '5.00 KM  FINISH' : `${km.toFixed(2)} KM`;
  if (lap || t >= T.finish) {
    const w = measure(label, F.mono(800, 32), 2) + 34;
    ctx.fillStyle = '#fff'; rrect(1020 - w, y - 36, w, 48, 8); ctx.fill();
    text(label, 1020 - 17, y, { font: F.mono(800, 32), align: 'right', color: '#000', ls: 2 });
  } else text(label, 1020, y, { font: F.mono(800, 32), align: 'right', ls: 2 });
  // five 1 km segments
  const x0 = 60, gw = (960 - 4 * 10) / 5;
  for (let i = 0; i < 5; i++) {
    const p = clamp(km - i);
    ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(x0 + i * (gw + 10), y + 26, gw, 6);
    ctx.fillStyle = '#fff'; ctx.fillRect(x0 + i * (gw + 10), y + 26, gw * p, 6);
  }
  ctx.restore();
}

// ================= SCENES =================
// FREEDOM logo geometry: 410×123 viewBox, FREE|DOM split along the italic slant
const LOGO_W = 410, LOGO_H = 123, CUT_TOP = 221, CUT_BOT = 200;
function drawFreedomSplit(lx, ly, lw, domDx, domA, key = 'freedom_w') {
  const s = lw / LOGO_W, lh = LOGO_H * s;
  ctx.save(); ctx.beginPath();
  ctx.moveTo(lx - 20, ly - 20); ctx.lineTo(lx + CUT_TOP * s, ly - 20); ctx.lineTo(lx + CUT_BOT * s, ly + lh + 20); ctx.lineTo(lx - 20, ly + lh + 20); ctx.clip();
  ctx.drawImage(IMG[key], lx, ly, lw, lh); ctx.restore();
  if (domA <= 0) return;
  const draw = () => {
    ctx.save(); ctx.beginPath();
    ctx.moveTo(lx + CUT_TOP * s, ly - 20); ctx.lineTo(lx + lw + 40, ly - 20); ctx.lineTo(lx + lw + 40, ly + lh + 20); ctx.lineTo(lx + CUT_BOT * s, ly + lh + 20); ctx.clip();
    ctx.drawImage(IMG[key], lx, ly, lw, lh); ctx.restore();
  };
  ctx.save(); ctx.globalAlpha *= domA; ctx.translate(domDx, 0);
  if (domDx > 2) echo(4, domDx * .18, 0, .5, draw); else draw();
  ctx.restore();
}

async function sceneHook(t) {
  // background: live AI clip if present, else three hard crops of the photo on the beat
  const k = Math.min(2, Math.floor(t / B));
  const lt = t - k * B;
  const clip = await clipFrame('hero', t + .3);
  const crops = [[1.35, .26, .40], [1.55, .68, .17], [2.1, .92, .6]];
  const bgFade = 1 - seg(t, T.dom + .05, T.dom + .3);
  if (bgFade > 0) {
    if (clip && k === 0) drawT(clip, cover(clip, 1.1 + lt * .08, .45, .45), bgFade);
    else { const [z, fx, fy] = crops[k]; drawT(IMG.photo, cover(IMG.photo, z * (1 + lt * .09), fx + lt * .02, fy), bgFade); }
    dim(.42 * bgFade);
    vgrad(1050, 1650, 0, .85 * bgFade);
  }
  speedLines(t, .55, 50, 3200, 1);

  // FREE → FREEDOM
  const pm = outExpo(seg(t, T.dom, T.dom + .32));
  const lwBig = 900 * LOGO_W / CUT_TOP, lwEnd = 940;
  const lw = lerp(lwBig, lwEnd, pm);
  const freeCx = (CUT_TOP + CUT_BOT) / 4 * (lw / LOGO_W);
  const lx = lerp(540 - freeCx, 540 - lw / 2, pm);
  const cy = lerp(880, 760, pm);
  const ly = cy - LOGO_H * lw / LOGO_W / 2;
  let pulse = 0;
  for (const bt of [B, 2 * B]) if (t >= bt && t < bt + .22) pulse = 1 - outCubic((t - bt) / .22);
  ctx.save(); ctx.translate(540, cy); ctx.scale(1 + pulse * .08, 1 + pulse * .08); ctx.translate(-540, -cy);
  if (pulse > .3) { ctx.save(); ctx.globalAlpha = .35 * pulse; drawFreedomSplit(lx - 40, ly, lw, 0, 0); ctx.restore(); }
  const domP = seg(t, T.dom, T.dom + .28);
  drawFreedomSplit(lx, ly, lw, (1 - outExpo(domP)) * 760, domP > 0 ? clamp(domP * 3) : 0);
  ctx.restore();

  // Korean hook lines (visible from frame 0 so the first frame reads as a poster)
  const subA = 1 - seg(t, T.dom - .05, T.dom + .15);
  if (subA > 0) {
    ctx.save(); ctx.globalAlpha = subA;
    text('참가비 0원.', 540, 1275, { font: F.kr(900, 96), ls: -2 });
    text('참가자 전원 러닝 상·하의 증정', 540, 1372, { font: F.kr(800, 54), ls: -1 });
    ctx.restore();
  }
  // × GTTEND lockup
  const pl = seg(t, T.lock, T.lock + .3);
  if (pl > 0) {
    text('×', 540, 1000, { font: F.anton(90), scale: outBack(pl), alpha: clamp(pl * 3) });
    ctx.save(); ctx.translate(540, 1110); const ss = outBack(seg(t, T.lock + .06, T.lock + .36));
    ctx.scale(ss, ss); ctx.rotate((1 - ss) * .8); svg('gttend_stars_w', 0, 0, 420); ctx.restore();
    rise(seg(t, T.lock + .12, T.lock + .4), 1170, 1330, () => svg('gttend_word_w', 540, 1245, 410));
    for (let i = 0; i < 6; i++) {
      const st = T.lock + .2 + i * .09, a = Math.sin(seg(t, st, st + .35) * Math.PI);
      if (a > 0) sparkle(540 + (rnd(i + 3) - .5) * 700, 1110 + (rnd(i + 9) - .5) * 360, 14 + rnd(i) * 26, a, t * 2);
    }
    rise(seg(t, T.lock + .2, T.lock + .45), 1400, 1500, () => text('프리덤 × 지텐드 러닝 세션', 540, 1470, { font: F.kr(700, 46), ls: -1, alpha: .9 }));
  }
}

async function sceneTitle(t) {
  // depth sandwich: plate < left runner < giant type < right man
  const lt = t - T.title;
  const z = 1 + lt * .03, fx = lerp(.32, .37, inOut(clamp(lt / 2.5)));
  const Tp = cover(IMG.photo, z, fx, .5);
  drawT(IMG.plate, Tp);
  dim(.5);
  speedLines(t, .75, 70, 4200, 2);
  drawT(IMG.runL, Tp);
  dim(.18);
  const fit = (w, max) => Math.min(max, max * 660 / measure(w, F.anton(max), 2));
  const w1 = outExpo(seg(t, T.title, T.title + .3)), w2 = outExpo(seg(t, T.title + 2 * B, T.title + 2 * B + .3));
  if (w1 > 0) {
    const x = 70 + (1 - w1) * -900 + lt * 22;
    echo(w1 < .9 ? 4 : 0, -60 * (1 - w1), 0, .4, () => text('RUNNING', x, 900, { font: F.anton(fit('RUNNING', 330)), align: 'left', skew: .12, ls: 2 }));
  }
  if (w2 > 0) {
    const x = 70 + (1 - w2) * -900 + (lt - 2 * B) * 22;
    echo(w2 < .9 ? 4 : 0, -60 * (1 - w2), 0, .4, () => text('CLUB', x, 1230, { font: F.anton(fit('RUNNING', 330)), align: 'left', skew: .12, ls: 2 }));
  }
  drawT(IMG.runR, Tp);
  vgrad(0, 560, .8, 0);
  vgrad(1250, H, 0, .9);
  rise(seg(t, T.title + .35, T.title + .65), 330, 470, () => {
    const lw = 330; svg('freedom_w', 90, 420, lw, 'l');
    text('×', 90 + lw + 38, 440, { font: F.anton(56) });
    svg('gttend_word_w', 90 + lw + 76, 420, 150, 'l');
  });
  const pb = seg(t, T.title + 3 * B + .2, T.title + 3 * B + .45);
  if (pb > 0) {
    ctx.save(); ctx.translate(300, 1370); const s = outBack(pb); ctx.scale(s, s); ctx.rotate(-.04);
    ctx.fillStyle = '#fff'; rrect(-230, -62, 460, 116, 10); ctx.fill();
    text('FIRST DROP', 0, 28, { font: F.anton(84), color: '#000', ls: 6 });
    ctx.restore();
  }
}

async function sceneDate(t) {
  const lt = t - T.date;
  drawT(IMG.photo, cover(IMG.photo, 1.25 + lt * .05, .3, .75));
  ctx.save(); ctx.filter = 'blur(6px)'; drawT(IMG.photo, cover(IMG.photo, 1.25 + lt * .05, .3, .75), 1); ctx.restore();
  dim(.72);
  speedLines(t, .35, 40, 2600, 3);
  chapterLabel(t, T.date, 'WHEN', '01 / 03');
  // slot-machine digits landing one after another
  const str = '10.10', font = F.anton(420);
  const total = measure(str, font, 4);
  let x = 540 - total / 2;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i], cw = measure(ch, font, 4);
    const land = T.date + .08 + i * .07;
    const p = seg(t, T.date - .02, land + .18);
    ctx.save(); ctx.beginPath(); ctx.rect(x - 10, 620, cw + 20, 420); ctx.clip();
    if (ch !== '.' && t < land) {
      const d = Math.floor(t * 40 + i * 3) % 10, off = ((t * 3400) % 420);
      ctx.globalAlpha = .9;
      text(String(d), x, 980 + off - 420, { font, align: 'left' });
      text(String((d + 1) % 10), x, 980 + off, { font, align: 'left' });
    } else {
      const yb = 980 + (1 - outBack(seg(t, land, land + .18))) * -120;
      text(ch, x, yb, { font, align: 'left', alpha: ch === '.' ? p : 1 });
    }
    ctx.restore();
    x += cw;
  }
  rise(seg(t, T.date + .35, T.date + .6), 1030, 1180, () => text('SAT', 540, 1160, { font: F.anton(150), stroke: 4, ls: 14 }));
  rise(seg(t, T.date + .5, T.date + .75), 1190, 1290, () => text('09:00 — 11:00', 540, 1270, { font: F.mono(800, 70), ls: 2 }));
  rise(seg(t, T.date + .65, T.date + .9), 1310, 1410, () => text('10월 10일 토요일 오전 9시', 540, 1390, { font: F.kr(800, 56), ls: -1 }));
}

function chapterLabel(t, t0, word, idx) {
  rise(seg(t, t0 + .02, t0 + .3), 440, 520, () => {
    text(word, 90, 505, { font: F.mono(800, 38), align: 'left', ls: 10 });
    text(idx, 990, 505, { font: F.mono(500, 30), align: 'right', ls: 4, alpha: .7 });
  });
  const p = outExpo(seg(t, t0 + .05, t0 + .45));
  ctx.fillStyle = '#fff'; ctx.fillRect(90, 530, 900 * p, 3);
}

async function scenePlace(t) {
  const lt = t - T.place;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const font = F.anton(250), word = 'SEONGSU  ', ww = measure(word, font, 6);
  for (let r = 0; r < 7; r++) {
    const y = 560 + r * 205, dir = r % 2 ? 1 : -1;
    const enter = (1 - outExpo(seg(t, T.place + r * .03, T.place + .35 + r * .03))) * 1400 * dir;
    const off = ((lt * 260 * dir) % ww + ww) % ww;
    const solid = r === 2;
    for (let k = -2; k < 3; k++) text(word, -off + k * ww + enter, y, { font, align: 'left', ls: 6, stroke: solid ? 0 : 2.5, alpha: solid ? 1 : .32 });
  }
  chapterLabel(t, T.place, 'WHERE', '02 / 03');
  // map pin drops onto the solid row
  const pp = seg(t, T.place + .25, T.place + .55);
  if (pp > 0) {
    const y = lerp(-200, 790, outBack(pp));
    ctx.save(); ctx.translate(540, y);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, -120, 70, Math.PI * .8, Math.PI * .2); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0, -122, 28, 0, 7); ctx.fill();
    ctx.restore();
  }
  const pb = outExpo(seg(t, T.place + .3, T.place + .6));
  ctx.fillStyle = '#000'; ctx.fillRect(0, 1165, W, 330 * pb);
  ctx.fillStyle = '#fff'; ctx.fillRect(90, 1165, 900 * pb, 3);
  rise(seg(t, T.place + .4, T.place + .65), 1190, 1350, () => text('라망 성수', 540, 1320, { font: F.kr(900, 130), ls: -3 }));
  rise(seg(t, T.place + .55, T.place + .8), 1350, 1440, () => text('서울 성동구 성수이로 127', 540, 1420, { font: F.kr(700, 46), ls: -1, alpha: .85 }));
}

async function sceneRun(t) {
  const lt = t - T.run;
  const clip = await clipFrame('legs', lt);
  if (clip) drawT(clip, cover(clip, 1.05, .5, .5));
  else { ctx.save(); ctx.filter = 'blur(3px)'; drawT(IMG.photo, cover(IMG.photo, 1.9 + lt * .08, .34 + lt * .02, .78)); ctx.restore(); }
  dim(.74);
  speedLines(t, .5, 60, 5200, 4);
  chapterLabel(t, T.run, 'DISTANCE', '03 / 03');
  const cx = 540, cy = 860, R = 290;
  const p = outCubic(seg(t, T.run + .1, T.run + 1.15));
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 22; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 22; ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); ctx.stroke();
  for (let i = 0; i < 60; i++) {
    const a = i / 60 * Math.PI * 2 - Math.PI / 2, r0 = R - 44, r1 = R - (i % 12 === 0 ? 70 : 56);
    ctx.globalAlpha = i / 60 <= p ? 1 : .25; ctx.lineWidth = i % 12 === 0 ? 5 : 2.5;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke();
  }
  ctx.restore();
  text((5 * p).toFixed(2), cx, cy + 50, { font: F.anton(230), ls: 2 });
  text('KM', cx, cy + 140, { font: F.mono(800, 46), ls: 12 });
  rise(seg(t, T.run + .35, T.run + .6), 1190, 1330, () => {
    text('AVG PACE', 90, 1235, { font: F.mono(800, 28), align: 'left', ls: 6, alpha: .7 });
    text(`6'30"`, 90, 1325, { font: F.anton(120), align: 'left', ls: 2 });
    text('/KM', 400, 1325, { font: F.mono(800, 40), align: 'left', alpha: .8 });
  });
  rise(seg(t, T.run + .5, T.run + .75), 1350, 1450, () => text('5km · 6분 30초 전후 페이스', 90, 1420, { font: F.kr(800, 52), align: 'left', ls: -1 }));
}

// receipt rows: [label, value]
const RC = [
  ['러닝 상·하의 세트', 'FREE'],
  ['프리덤 삭스', 'FREE'],
  ['러닝 후 커피', 'FREE'],
  ['FW 신상 · 현장 추첨', 'BONUS'],
  ['참가비', '₩0'],
];
const RC_T = [10.6, 11.1, 11.6, 12.1, 12.6];
function sceneReceipt(t) {
  const lt = t - T.rcpt;
  ctx.fillStyle = '#0b0b0b'; ctx.fillRect(0, 0, W, H);
  drawT(IMG.plate, cover(IMG.plate, 1.1, .5, .4), .25);
  speedLines(t, .25, 30, 1800, 5);
  rise(seg(t, T.rcpt + .02, T.rcpt + .3), 330, 470, () => {
    text('WHAT YOU GET', 540, 440, { font: F.anton(118), ls: 4 });
  });
  // printer slot
  const px = 110, pw = 860, slot = 520;
  ctx.fillStyle = '#1e1e1e'; rrect(px - 30, slot - 26, pw + 60, 40, 20); ctx.fill();
  ctx.fillStyle = '#000'; ctx.fillRect(px - 10, slot - 8, pw + 20, 10);
  // rows layout (relative to paper top)
  const rows = [];
  let y = 0;
  const HEAD = 150, ROW = 84;
  rows.push({ t: 10.25, y0: 0, y1: HEAD });
  RC.forEach((r, i) => rows.push({ t: RC_T[i], y0: HEAD + i * ROW, y1: HEAD + (i + 1) * ROW }));
  const totalY = HEAD + RC.length * ROW;
  rows.push({ t: 13.1, y0: totalY, y1: totalY + 190 });
  rows.push({ t: 13.35, y0: totalY + 190, y1: totalY + 300 });
  let shown = 0;
  for (const r of rows) {
    const p = outCubic(seg(t, r.t, r.t + .16));
    if (p > 0) shown = lerp(r.y0, r.y1, p);
  }
  if (shown <= 0) return;
  const jit = rows.some(r => t >= r.t && t < r.t + .16) ? (rnd(Math.floor(t * 60)) - .5) * 3 : 0;
  ctx.save();
  ctx.translate(540, slot); ctx.rotate(-.012); ctx.translate(-540, -slot);
  ctx.beginPath(); ctx.rect(px - 40, slot, pw + 80, shown + 40); ctx.clip();
  ctx.translate(jit, 0);
  // paper with zigzag bottom
  ctx.fillStyle = '#f1efe9'; ctx.beginPath(); ctx.moveTo(px, slot);
  ctx.lineTo(px + pw, slot); ctx.lineTo(px + pw, slot + shown);
  for (let zx = px + pw; zx > px; zx -= 20) ctx.lineTo(zx - 10, slot + shown + (zx / 20 % 2 ? 12 : 0));
  ctx.lineTo(px, slot + shown); ctx.closePath(); ctx.fill();
  const K = '#111', top = slot;
  svg('freedom_k', 540 - 150, top + 62, 210);
  text('×', 540, top + 76, { font: F.anton(40), color: K });
  svg('gttend_word_k', 540 + 130, top + 62, 130);
  text('RUN SESSION 01 · 2026.10.10 SAT', 540, top + 124, { font: F.mono(500, 26), color: K, ls: 1 });
  dashed(px + 40, px + pw - 40, top + HEAD - 6, K);
  RC.forEach(([l, v], i) => {
    const yy = top + HEAD + i * ROW + 56;
    text(l, px + 44, yy, { font: F.kr(800, 42), color: K, align: 'left', ls: -1 });
    const vx = px + pw - 44;
    text(v, vx, yy, { font: F.mono(800, 40), color: K, align: 'right' });
    const lw = measure(l, F.kr(800, 42), -1), vw = measure(v, F.mono(800, 40));
    ctx.fillStyle = K;
    for (let dx = px + 64 + lw; dx < vx - vw - 20; dx += 16) ctx.fillRect(dx, yy - 10, 5, 5);
  });
  dashed(px + 40, px + pw - 40, top + totalY + 6, K);
  text('TOTAL', px + 44, top + totalY + 150, { font: F.anton(96), color: K, align: 'left', ls: 3 });
  const tp = seg(t, 13.1, 13.3);
  text('₩0', px + pw - 44, top + totalY + 158, { font: F.anton(170), color: K, align: 'right', scale: 1 + (1 - outExpo(tp)) * .4 });
  text('* 러닝 상·하의 · 삭스 · 커피는 참가자 전원 제공', 540, top + totalY + 232, { font: F.kr(600, 28), color: K });
  for (let i = 0; i < 70; i++) { const bw = 2 + Math.floor(rnd(i + 40) * 3) * 2; ctx.fillStyle = K; ctx.fillRect(px + 150 + i * 8.4, top + totalY + 252, bw * .8, 34); }
  ctx.restore();
  // FREE stamp
  const sp = seg(t, 13.75, 13.9);
  if (sp > 0) {
    ctx.save(); ctx.translate(690, slot + HEAD + 190); ctx.rotate(-.24);
    const s = lerp(2.6, 1, outExpo(sp)); ctx.scale(s, s); ctx.globalAlpha = clamp(sp * 2) * .9;
    ctx.drawImage(STAMP, -310, -150); ctx.restore();
  }
}
function dashed(x0, x1, y, col) { ctx.fillStyle = col; for (let x = x0; x < x1; x += 22) ctx.fillRect(x, y, 12, 3); }

// ---------- HOW TO JOIN ----------
const STEPS = [
  ['FOLLOW', '두 계정 모두 팔로우'],
  ['LIKE', '본 게시물 좋아요'],
  ['COMMENT', '성별 / 상하의 사이즈 / 촬영 동의'],
  ['TAG', '함께 뛰고 싶은 친구 태그'],
];
function tap(x, y, t, t0) {
  const p = seg(t, t0 - .12, t0 + .3);
  if (p <= 0 || p >= 1) return;
  ctx.save();
  if (t < t0) { ctx.globalAlpha = .8; ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(x, y, 46, 0, 7); ctx.fill(); }
  else { const q = seg(t, t0, t0 + .3); ctx.globalAlpha = 1 - q; ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(x, y, 30 + q * 70, 0, 7); ctx.stroke(); }
  ctx.restore();
}
function heart(cx, cy, s) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * .35);
  ctx.bezierCurveTo(cx - s * 1.05, cy - s * .35, cx - s * .45, cy - s * 1.05, cx, cy - s * .45);
  ctx.bezierCurveTo(cx + s * .45, cy - s * 1.05, cx + s * 1.05, cy - s * .35, cx, cy + s * .35);
  ctx.closePath();
}
function avatar(x, y, r, kind) {
  ctx.save(); ctx.fillStyle = '#000'; ctx.strokeStyle = '#444'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke();
  if (kind === 'f') svg('freedom_w', x, y, r * 1.5);
  else if (kind === 'g') svg('gttend_stars_w', x, y, r * 1.45);
  else { ctx.fillStyle = '#555'; ctx.beginPath(); ctx.arc(x, y - r * .2, r * .38, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(x, y + r * .75, r * .62, Math.PI, 0); ctx.fill(); }
  ctx.restore();
}
const CMT = '남 / 상하의 XL / 촬영동의 Y';
const TAG = ' / @친구계정';
function sceneSteps(t) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  drawT(IMG.photo, cover(IMG.photo, 1.5, .7, .3), .16);
  speedLines(t, .2, 26, 1600, 6);
  rise(seg(t, T.km3 + .02, T.km3 + .3), 330, 470, () => {
    text('HOW TO JOIN', 90, 440, { font: F.anton(118), align: 'left', ls: 4 });
  });
  const si = clamp(Math.floor((t - T.km3) / 1.25), 0, 3);
  const st = T.steps[si], lt = t - st;
  // step dots
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i <= si ? '#fff' : 'rgba(255,255,255,.25)';
    rrect(90 + i * 228, 478, 216, 8, 4); ctx.fill();
  }
  // number + title
  const pin = seg(t, st, st + .25);
  rise(pin, 520, 700, () => {
    text(String(si + 1).padStart(2, '0'), 90, 680, { font: F.anton(170), align: 'left' });
    text(STEPS[si][0], 300, 680, { font: F.anton(170), align: 'left', ls: 3 });
  });
  rise(seg(t, st + .08, st + .33), 700, 790, () => text(STEPS[si][1], 90, 770, { font: F.kr(800, 52), align: 'left', ls: -1 }));
  // UI card
  const cx = 90, cy = 830, cw = 900, ch = 600;
  ctx.fillStyle = '#131313'; rrect(cx, cy, cw, ch, 36); ctx.fill();
  ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 3; rrect(cx, cy, cw, ch, 36); ctx.stroke();
  ctx.save(); rrect(cx, cy, cw, ch, 36); ctx.clip();
  const cin = outExpo(seg(t, st, st + .3));
  ctx.translate((1 - cin) * 120, 0); ctx.globalAlpha = cin;
  if (si === 0) {
    [['freedom_whatever', 'FREEDOM', 'f', st + .45], ['gttendclub', 'GTTEND RUNNING CLUB', 'g', st + .8]].forEach(([h, sub, k, tt], i) => {
      const y = cy + 170 + i * 250;
      avatar(cx + 110, y, 66, k);
      text(h, cx + 200, y - 6, { font: F.kr(700, 44), align: 'left' });
      text(sub, cx + 200, y + 40, { font: F.mono(500, 26), align: 'left', alpha: .6 });
      const on = t >= tt, bx = cx + cw - 250, by = y - 40;
      const pop = t >= tt ? 1 + (1 - outCubic(seg(t, tt, tt + .2))) * .12 : 1;
      ctx.save(); ctx.translate(bx + 110, by + 40); ctx.scale(pop, pop); ctx.translate(-bx - 110, -by - 40);
      ctx.fillStyle = on ? '#2a2a2a' : '#fff'; rrect(bx, by, 220, 80, 16); ctx.fill();
      text(on ? '팔로잉 ✓' : '팔로우', bx + 110, by + 54, { font: F.kr(800, 38), color: on ? '#fff' : '#000' });
      ctx.restore();
      tap(bx + 110, by + 40, t, tt);
    });
  } else if (si === 1) {
    const ix = cx + 60, iy = cy + 40, iw = 360, ih = 450;
    ctx.drawImage(IMG.poster, ix, iy, iw, ih);
    const lk = st + .5, liked = t >= lk;
    const bp = seg(t, lk, lk + .5);
    if (bp > 0 && bp < 1) { ctx.save(); ctx.globalAlpha = 1 - inExpo(bp); ctx.fillStyle = '#fff'; heart(ix + iw / 2, iy + ih / 2 + 20, 120 * outBack(clamp(bp * 2.5))); ctx.fill(); ctx.restore(); }
    const hs = liked ? 1 + (1 - outCubic(seg(t, lk, lk + .25))) * .35 : 1;
    ctx.save(); ctx.translate(ix + 40, iy + ih + 60); ctx.scale(hs, hs);
    ctx.lineWidth = 6; ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; heart(0, 0, 36); liked ? ctx.fill() : ctx.stroke(); ctx.restore();
    text(liked ? '158' : '157', ix + 96, iy + ih + 74, { font: F.kr(700, 40), align: 'left' });
    text('gttendclub', cx + 470, cy + 110, { font: F.kr(800, 42), align: 'left' });
    text('FREEDOM × GTTEND', cx + 470, cy + 170, { font: F.anton(46), align: 'left', ls: 1 });
    text('RUN SESSION', cx + 470, cy + 222, { font: F.anton(46), align: 'left', ls: 1 });
    text('10.10 SAT · 성수', cx + 470, cy + 280, { font: F.kr(600, 34), align: 'left', alpha: .6 });
    for (let i = 0; i < 8; i++) {
      const pa = seg(t, lk, lk + .45); if (pa <= 0 || pa >= 1) continue;
      const a = i / 8 * Math.PI * 2, r = 40 + pa * 90;
      sparkle(ix + 40 + Math.cos(a) * r, iy + ih + 60 + Math.sin(a) * r, 12 * (1 - pa), 1 - pa);
    }
    tap(ix + iw / 2, iy + ih / 2, t, lk);
  } else {
    // comment composer (steps 3 and 4 share it)
    const n3 = Math.floor(clamp((t - (T.steps[2] + .25)) / .75) * CMT.length);
    const n4 = Math.floor(clamp((t - (T.steps[3] + .2)) / .4) * TAG.length);
    const typed = CMT.slice(0, si === 2 ? n3 : CMT.length);
    const tag = si === 3 ? TAG.slice(0, n4) : '';
    const posted = si === 3 && t >= T.steps[3] + .85;
    // posted comment bubble
    if (posted) {
      const pp = outExpo(seg(t, T.steps[3] + .85, T.steps[3] + 1.1));
      ctx.save(); ctx.globalAlpha *= pp; ctx.translate(0, (1 - pp) * 60);
      avatar(cx + 90, cy + 110, 44, 'u');
      text('my_run_account', cx + 160, cy + 96, { font: F.kr(800, 34), align: 'left' });
      text(CMT + ' /', cx + 160, cy + 146, { font: F.kr(700, 36), align: 'left' });
      text('@친구계정', cx + 160 + measure(CMT + ' / ', F.kr(700, 36)), cy + 146, { font: F.kr(800, 36), align: 'left' });
      text('방금 전 · 좋아요 · 답글 달기', cx + 160, cy + 196, { font: F.kr(600, 26), align: 'left', alpha: .5 });
      ctx.restore();
    } else {
      // size guide
      const gp = outExpo(seg(t, T.steps[2] + .45, T.steps[2] + .7));
      ctx.save(); ctx.globalAlpha *= gp;
      [['여성', 'S – M'], ['남성', 'L – 4XL']].forEach(([g, s], i) => {
        const x = cx + 50 + i * 410;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; rrect(x, cy + 60, 390, 150, 20); ctx.stroke();
        text(g, x + 30, cy + 118, { font: F.kr(800, 36), align: 'left', alpha: .7 });
        text(s, x + 30, cy + 186, { font: F.anton(64), align: 'left', ls: 2 });
      });
      text('* 상하의 사이즈 통일', cx + 50, cy + 262, { font: F.kr(600, 30), align: 'left', alpha: .6 });
      ctx.restore();
    }
    const fy = cy + 400;
    avatar(cx + 90, fy + 50, 44, 'u');
    ctx.strokeStyle = '#444'; ctx.lineWidth = 3; rrect(cx + 160, fy, 690, 100, 50); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.rect(cx + 180, fy, 540, 100); ctx.clip();
    const tf = F.kr(700, 36);
    const full = typed + tag, fw = measure(full, tf);
    const sx = Math.min(0, 520 - fw);
    if (!full && !posted) text('댓글 달기...', cx + 196, fy + 63, { font: tf, align: 'left', alpha: .4 });
    text(typed, cx + 196 + sx, fy + 63, { font: tf, align: 'left' });
    if (tag) {
      const tx = cx + 196 + sx + measure(typed, tf);
      text(tag, tx, fy + 63, { font: F.kr(800, 36), align: 'left' });
    }
    if (!posted && Math.floor(t * 3) % 2 === 0) { ctx.fillStyle = '#fff'; ctx.fillRect(cx + 200 + sx + fw, fy + 28, 4, 46); }
    ctx.restore();
    const ready = si === 3 && n4 >= TAG.length;
    text('게시', cx + 790, fy + 64, { font: F.kr(800, 36), alpha: ready ? 1 : .35 });
    if (si === 3) tap(cx + 790, fy + 50, t, T.steps[3] + .8);
  }
  ctx.restore();
}

// ---------- ONLY 40 ----------
function sceneOnly(t) {
  const lt = t - T.only;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  speedLines(t, .3, 30, 2400, 9);
  const n = Math.floor(clamp(lt / .85) * 40);
  rise(seg(t, T.only, T.only + .25), 400, 560, () => text('ONLY', 540, 540, { font: F.anton(150), ls: 24 }));
  const s = 1 + (1 - outExpo(seg(t, T.only, T.only + .3))) * .5;
  text(String(Math.min(40, n)).padStart(2, '0'), 540, 1010, { font: F.anton(500), scale: s, ls: 6 });
  // 40 bib slots filling up
  const cols = 10, cw = 80, chh = 44, g = 10;
  const gx = 540 - (cols * cw + (cols - 1) * g) / 2, gy = 1050;
  for (let i = 0; i < 40; i++) {
    const x = gx + (i % cols) * (cw + g), y = gy + Math.floor(i / cols) * (chh + g);
    const on = i < n;
    ctx.fillStyle = on ? '#fff' : 'rgba(255,255,255,.1)'; rrect(x, y, cw, chh, 6); ctx.fill();
    text(String(i + 1).padStart(2, '0'), x + cw / 2, y + 31, { font: F.mono(800, 22), color: on ? '#000' : 'rgba(255,255,255,.3)' });
  }
  rise(seg(t, T.only + .3, T.only + .55), 1270, 1420, () => text('단 40명 추첨', 540, 1395, { font: F.kr(900, 116), ls: -3 }));
}

// ---------- DEADLINE (inverted) ----------
function sceneDeadline(t) {
  const lt = t - T.dead;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  const K = '#000';
  rise(seg(t, T.dead, T.dead + .25), 440, 540, () => text('DEADLINE', 90, 520, { font: F.mono(800, 40), color: K, align: 'left', ls: 12 }));
  ctx.fillStyle = K; ctx.fillRect(90, 545, 900 * outExpo(seg(t, T.dead + .05, T.dead + .4)), 4);
  const s = 1 + (1 - outExpo(seg(t, T.dead, T.dead + .3))) * .35;
  text('10.03', 540, 930, { font: F.anton(400), color: K, scale: s, ls: 4 });
  rise(seg(t, T.dead + .2, T.dead + .45), 960, 1110, () => text('SAT 18:00', 540, 1095, { font: F.anton(160), color: K, ls: 8 }));
  rise(seg(t, T.dead + .35, T.dead + .6), 1130, 1280, () => {
    ctx.fillStyle = K; rrect(270, 1140, 540, 136, 14); ctx.fill();
    text('신청 마감', 540, 1250, { font: F.kr(900, 104), color: '#fff', ls: -3 });
  });
  rise(seg(t, T.dead + .5, T.dead + .75), 1300, 1400, () => text('당첨자는 10/3 18시 이후 개별 안내', 540, 1370, { font: F.kr(700, 44), color: K, ls: -1 }));
  if (DDAY) {
    const p = seg(t, T.dead + .45, T.dead + .7);
    if (p > 0) {
      ctx.save(); ctx.translate(850, 640); ctx.rotate(.18); const k = outBack(p); ctx.scale(k, k);
      ctx.fillStyle = K; rrect(-130, -70, 260, 130, 65); ctx.fill();
      text(DDAY, 0, 38, { font: F.anton(100), color: '#fff', ls: 2 }); ctx.restore();
    }
  }
  // ticking second hand
  const a = Math.floor(lt * 8) / 8 * Math.PI * 2 * .25 - Math.PI / 2;
  ctx.save(); ctx.strokeStyle = K; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(900, 1520 - 40, 34, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(900, 1480); ctx.lineTo(900 + Math.cos(a) * 24, 1480 + Math.sin(a) * 24); ctx.stroke(); ctx.restore();
}

// ---------- FINISH TAPE + END CARD ----------
function sceneTape(t) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const p = seg(t, T.tape, T.finish);
  speedLines(t, .9, 90, 7000, 7);
  // runners rushing at the lens
  const z = lerp(.62, 1.5, inExpo(p));
  const Tp = cover(IMG.photo, 1, .5, .5);
  ctx.save(); ctx.translate(540, 1000); ctx.scale(z, z); ctx.translate(-540, -1000);
  drawT(IMG.people, Tp); ctx.restore();
  // tape
  ctx.save(); ctx.translate(0, 1000);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, -44, W, 88);
  const off = (t * 900) % 330;
  for (let k = -1; k < 5; k++) text('FINISH', k * 330 - off, 26, { font: F.anton(70), color: '#000', align: 'left', ls: 8 });
  ctx.restore();
}
async function sceneEnd(t) {
  const lt = t - T.finish;
  // tape halves flying away
  const Tp = cover(IMG.photo, 1.08 + lt * .03, .5, .45);
  const clip = await clipFrame('hero', 1.5 + lt);
  if (clip) drawT(clip, cover(clip, 1.05 + lt * .02, .5, .45)); else drawT(IMG.photo, Tp);
  dim(.5);
  vgrad(0, 700, .85, 0); vgrad(900, H, 0, .95);
  speedLines(t, .35, 40, 3000, 8);
  const tp = seg(t, T.finish, T.finish + .5);
  if (tp < 1) {
    for (const side of [-1, 1]) {
      ctx.save(); ctx.translate(540 + side * (270 + outCubic(tp) * 500), 1000 + outCubic(tp) * 200);
      ctx.rotate(side * outCubic(tp) * .6); ctx.globalAlpha = 1 - tp;
      ctx.fillStyle = '#fff'; ctx.fillRect(-270, -44, 540, 88); ctx.restore();
    }
  }
  // lockup
  rise(seg(t, T.finish + .1, T.finish + .4), 380, 560, () => {
    const lw = 460; svg('freedom_w', 90, 470, lw, 'l');
    text('×', 90 + lw + 44, 494, { font: F.anton(70) });
    svg('gttend_w', 90 + lw + 180, 470, 170, 'c');
  });
  rise(seg(t, T.finish + .2, T.finish + .45), 880, 1080, () => text('RUNNING CLUB', 540, 1050, { font: F.anton(190), skew: .1, ls: 2 }));
  const fb = seg(t, T.finish + .35, T.finish + .6);
  if (fb > 0) {
    ctx.save(); ctx.translate(540, 1115); const k = outBack(fb); ctx.scale(k, k);
    text('FIRST DROP  ·  10.10 SAT  ·  라망 성수', 0, 18, { font: F.kr(800, 42), ls: 0 }); ctx.restore();
  }
  // CTA
  const cp = outExpo(seg(t, T.finish + .5, T.finish + .8));
  if (cp > 0) {
    const pulse = 1 + Math.sin(Math.max(0, lt - .8) * Math.PI * 2 / (2 * B)) * .025;
    ctx.save(); ctx.translate(540, 1275); ctx.scale(cp * pulse, cp * pulse);
    ctx.fillStyle = '#fff'; rrect(-400, -70, 800, 140, 70); ctx.fill();
    text('지금 댓글로 신청하기  →', 0, 18, { font: F.kr(900, 54), color: '#000', ls: -1 });
    // shine sweep
    const sh = ((lt - .9) % 1.2) / 1.2;
    if (lt > .9) {
      ctx.save(); rrect(-400, -70, 800, 140, 70); ctx.clip(); ctx.globalCompositeOperation = 'source-atop';
      const x = lerp(-600, 600, sh), g = ctx.createLinearGradient(x - 120, 0, x + 120, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(.5, 'rgba(0,0,0,.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(-400, -70, 800, 140); ctx.restore();
    }
    ctx.restore();
  }
  rise(seg(t, T.finish + .7, T.finish + .95), 1360, 1440, () => text('@freedom_whatever   @gttendclub', 540, 1420, { font: F.mono(800, 32), ls: 1, alpha: .85 }));
  rise(seg(t, T.finish + .8, T.finish + 1.05), 1440, 1500, () => text('마감 10.03 SAT 18:00 · 40명 추첨 · 참가비 무료', 540, 1482, { font: F.kr(700, 32), alpha: .7 }));
}

// ---------- transitions ----------
function starWipe(t) {
  for (const tb of [T.title, T.km1, T.km2, T.km3, T.km4]) {
    const p = seg(t, tb - .2, tb);
    if (p > 0 && p < 1) { ctx.fillStyle = '#fff'; starPath(540, 960, inExpo(p) * 3400 + 10, p * 1.2); ctx.fill(); }
  }
  // step changes inside chapter 4 and 2 get a quick flash via impacts only
}

// ---------- master ----------
async function render(t) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const [sx, sy] = shakeOffset(t);
  ctx.translate(sx, sy);
  if (t < T.title) await sceneHook(t);
  else if (t < T.km1) await sceneTitle(t);
  else if (t < T.place) await sceneDate(t);
  else if (t < T.run) await scenePlace(t);
  else if (t < T.km2) await sceneRun(t);
  else if (t < T.km3) sceneReceipt(t);
  else if (t < T.km4) sceneSteps(t);
  else if (t < T.dead) sceneOnly(t);
  else if (t < T.tape) sceneDeadline(t);
  else if (t < T.finish) sceneTape(t);
  else await sceneEnd(t);
  ctx.restore();
  starWipe(t);
  // impact flash
  const fl = impactEnv(t, 14) * .55 + (t > 24.85 ? seg(t, 24.85, 25) * .9 : 0);
  if (fl > 0 && t > .02) { ctx.fillStyle = `rgba(255,255,255,${Math.min(.9, fl)})`; ctx.fillRect(0, 0, W, H); }
  hud(t);
  // film grain + vignette
  ctx.save();
  ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = .38;
  ctx.drawImage(GRAIN[Math.floor(t * FPS) % GRAIN.length], 0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = .05;
  ctx.drawImage(GRAIN[(Math.floor(t * FPS) + 3) % GRAIN.length], 0, 0, W, H);
  ctx.restore();
  const vg = ctx.createRadialGradient(540, 960, 600, 540, 960, 1250);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.45)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
}

// ---------- audio cue sheet (consumed by tools/make_audio.py) ----------
function cues() {
  const c = [];
  const add = (t, type, v = 1) => c.push({ t: +t.toFixed(4), type, v });
  IMPACTS.forEach(([t, s]) => add(t, 'impact', s));
  [5, 10, 15, 20].forEach(t => add(t - .02, 'lap'));
  add(24.9, 'finishbeep');
  [T.title, T.km1, T.km2, T.km3, T.km4].forEach(t => add(t - .22, 'whoosh'));
  add(T.dom, 'swipe');
  add(T.lock + .1, 'sparkle');
  for (let i = 0; i < 5; i++) add(T.date + .08 + i * .07, 'slot');
  add(T.place + .5, 'thud');
  add(T.run + .1, 'riser_short');
  add(10.25, 'print'); RC_T.forEach(t => add(t, 'print')); add(13.1, 'print'); add(13.35, 'print');
  add(13.75, 'stamp');
  add(15.45, 'tap'); add(15.8, 'tap'); add(16.75, 'pop');
  for (let i = 0; i < CMT.length; i++) add(T.steps[2] + .25 + i * (.75 / CMT.length), 'key');
  for (let i = 0; i < TAG.length; i++) add(T.steps[3] + .2 + i * (.4 / TAG.length), 'key');
  add(T.steps[3] + .8, 'tap'); add(T.steps[3] + .85, 'send');
  for (let i = 0; i < 40; i += 2) add(T.only + i / 40 * .85, 'count');
  add(T.tape - .9, 'riser');
  add(T.finish, 'snap');
  return c;
}

window.renderFrame = f => render(f / FPS);
window.renderTime = t => render(t);
window.META = { W, H, FPS, DUR, BPM };
window.__ready = load().then(() => { window.CUES = cues(); return true; });

// live preview when opened in a browser (not while the renderer drives it)
if (!Q.has('render')) {
  window.__ready.then(() => {
    const t0 = performance.now();
    let busy = false;
    const tick = async () => {
      if (!busy) { busy = true; await render(((performance.now() - t0) / 1000) % DUR); busy = false; }
      requestAnimationFrame(tick);
    };
    tick();
  });
}
})();
