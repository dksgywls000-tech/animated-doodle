// 디자인 검토용 스크린샷: node e2e/shots.mjs <outDir>
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? 'e2e/screenshots';
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const exe = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe });
const widths = (process.env.WIDTHS ?? '390').split(',').map(Number);
for (const w of widths) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w >= 1024 ? 900 : 844 }, deviceScaleFactor: 2, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/');
  await page.getByText('입장하기').waitFor();
  await page.screenshot({ path: `${out}/${w}-01-login.png` });
  const who = process.env.WHO ?? '테스트관리자,TEST-0002';
  const [n, e] = who.split(',');
  await page.getByLabel('이름').fill(n);
  await page.getByLabel('사번').fill(e);
  await page.getByRole('button', { name: '입장하기' }).click();
  await page.getByText('LUCKY TICKET · 행운권').first().waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${w}-02-pass.png`, fullPage: true });
  for (const [hash, name] of [['/schedule', '03-schedule'], ['/map/seat', '04-map'], ['/chat', '05-chat']]) {
    await page.goto(BASE + '/#' + hash); await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/${w}-${name}.png`, fullPage: hash !== '/chat' });
  }
  await page.goto(BASE + '/#/admin'); await page.getByText('점수판').first().waitFor(); await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${w}-06-admin.png`, fullPage: true });
  await page.getByRole('button', { name: /^3조 .*점수 부여/ }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${w}-07-award.png` });
  await ctx.close();
}
await browser.close();
