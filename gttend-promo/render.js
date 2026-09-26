// Render index.html frame-by-frame with Playwright, then mux with the soundtrack.
//   node render.js                 -> build/grace-ten-promo.mp4
//   node render.js --stills 1,4.8  -> build/still_<t>.jpg for quick checks
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const FPS = 30, DUR = 25, W = 1080, H = 1920;
const WORKERS = 4;
const OUT = path.join(ROOT, 'build');
const FRAMES = path.join(OUT, 'frames');

const MIME = { '.html': 'text/html', '.ttf': 'font/ttf', '.jpg': 'image/jpeg', '.png': 'image/png', '.js': 'text/javascript' };
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rsp);
    }).listen(0, () => res(srv));
  });
}

async function openPage(browser, port) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/index.html?render`);
  await page.evaluate(() => window.ready);
  return page;
}

(async () => {
  fs.mkdirSync(FRAMES, { recursive: true });
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text'] });
  const stillsArg = process.argv.indexOf('--stills');
  if (stillsArg > -1) {
    const page = await openPage(browser, port);
    for (const t of process.argv[stillsArg + 1].split(',').map(Number)) {
      await page.evaluate(t => window.render(t), t);
      await page.screenshot({ path: path.join(OUT, `still_${t.toFixed(2)}.jpg`), type: 'jpeg', quality: 85 });
    }
    await browser.close(); srv.close(); return;
  }
  const total = FPS * DUR;
  let next = 0, done = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    const page = await openPage(browser, port);
    while (next < total) {
      const f = next++;
      await page.evaluate(t => window.render(t), f / FPS);
      await page.screenshot({ path: path.join(FRAMES, `f${String(f).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 95 });
      if (++done % 75 === 0) console.log(`${done}/${total} frames  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  }));
  await browser.close(); srv.close();

  const ffmpeg = execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
  execFileSync('python3', [path.join(ROOT, 'audio.py')], { cwd: ROOT, stdio: 'inherit' });
  execFileSync(ffmpeg, ['-y', '-framerate', String(FPS), '-i', path.join(FRAMES, 'f%04d.jpg'), '-i', path.join(OUT, 'audio.wav'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-shortest', path.join(OUT, 'grace-ten-promo.mp4')], { stdio: 'inherit' });
  console.log('done ->', path.join(OUT, 'grace-ten-promo.mp4'));
})();
