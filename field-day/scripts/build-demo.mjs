// 미리보기 데모를 HTML 파일 하나로 묶는다: dist/demo → dist/field-day-demo.html
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

execSync('npx vite build --config vite.demo.config.ts', { stdio: 'inherit' });
const dir = 'dist/demo';
let html = readFileSync(join(dir, 'index.html'), 'utf8');
const assets = join(dir, 'assets');
for (const f of readdirSync(assets)) {
  const body = readFileSync(join(assets, f), 'utf8');
  if (f.endsWith('.js')) {
    html = html.replace(new RegExp(`<script[^>]*src="\\./assets/${f.replace('.', '\\.')}"[^>]*></script>`), () => `<script type="module">${body.replace(/<\/script/g, '<\\/script')}</script>`);
  } else if (f.endsWith('.css')) {
    html = html.replace(new RegExp(`<link[^>]*href="\\./assets/${f.replace('.', '\\.')}"[^>]*>`), () => `<style>${body}</style>`);
  }
}
if (/src="\.\/assets|href="\.\/assets/.test(html)) throw new Error('inline failed');
writeFileSync('dist/field-day-demo.html', html);
console.log(`dist/field-day-demo.html ${(html.length / 1024).toFixed(0)}KB`);
