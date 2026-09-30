// Render motion.js frame-by-frame with headless Chromium and encode with ffmpeg.
// usage: node tools/render.mjs --out out/video.mp4 [--dday D-3] [--frames 0,30,60 --png dir] [--audio out/audio.wav]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') && a.push([v.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? true : arr[i + 1]]), a), []));
const FF = execSync(`python3 -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"`).toString().trim();

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({ args: ['--disable-gpu-vsync', '--font-render-hinting=none'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('PAGE ERROR', e.message));
page.on('console', m => m.type() === 'error' && console.error('console:', m.text()));
const q = new URLSearchParams({ render: '1', ...(args.dday ? { dday: args.dday } : {}) });
await page.goto(`http://127.0.0.1:${port}/index.html?${q}`);
await page.evaluate(() => window.__ready);
const meta = await page.evaluate(() => window.META);
fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'out', 'cues.json'), JSON.stringify(await page.evaluate(() => window.CUES), null, 1));

const grab = async f => {
  const b64 = await page.evaluate(async f => { await window.renderFrame(f); return document.getElementById('c').toDataURL('image/jpeg', 0.95).slice(23); }, f);
  return Buffer.from(b64, 'base64');
};

if (args.frames) {
  const dir = path.join(ROOT, args.png || 'out/frames');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of String(args.frames).split(',').map(Number)) fs.writeFileSync(path.join(dir, `f${String(f).padStart(4, '0')}.jpg`), await grab(f));
} else {
  const out = path.join(ROOT, args.out || 'out/video.mp4');
  const n = Math.round(meta.DUR * meta.FPS);
  const ff = ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(meta.FPS), '-c:v', 'mjpeg', '-i', '-'];
  if (args.audio) ff.push('-i', path.join(ROOT, args.audio));
  ff.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-maxrate', '14M', '-bufsize', '28M', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(meta.FPS), '-movflags', '+faststart');
  if (args.audio) ff.push('-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest');
  ff.push(out);
  const p = spawn(FF, ff, { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let f = 0; f < n; f++) {
    const buf = await grab(f);
    if (!p.stdin.write(buf)) await new Promise(r => p.stdin.once('drain', r));
    if (f % 150 === 0) console.log(`frame ${f}/${n}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  p.stdin.end();
  await new Promise(r => p.on('close', r));
  console.log('wrote', out);
}
await browser.close();
server.close();
