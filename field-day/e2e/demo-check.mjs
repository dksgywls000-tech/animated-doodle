// 단일 HTML 데모 검증: node e2e/demo-check.mjs <screenshotDir>
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
const out = process.argv[2];
const url = 'file://' + resolve('dist/field-day-demo.html');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const login = async (p, n, e) => {
  await p.getByLabel('이름').fill(n); await p.getByLabel('사번').fill(e);
  await p.getByRole('button', { name: '입장하기' }).click();
  await p.locator('.ticket-no').waitFor();
};
const A = await ctx.newPage(); A.on('pageerror', (e) => errors.push(e.message));
await A.goto(url);
await A.getByRole('button', { name: '입장하기' }).waitFor();
await A.screenshot({ path: `${out}/d1-login-panel.png` });
await A.getByRole('button', { name: '닫기' }).click();
await login(A, '테스트참가자 다', 'TEST-0005');
const t1 = await A.locator('.ticket-no').innerText();
ok(/No\.\d{3}/.test(t1), 'ticket ' + t1);
await A.screenshot({ path: `${out}/d2-pass.png` });
ok((await A.locator('.nownext').innerText()).includes('단체줄넘기'), 'now = 단체줄넘기 at simulated 14:10');
await A.reload(); await A.locator('.ticket-no').waitFor();
ok((await A.locator('.ticket-no').innerText()) === t1, 'ticket stable after reload');
await A.goto(url + '#/map/seat'); await A.waitForTimeout(500);
const nat = await A.locator('.map-thumb img').evaluate((i) => i.naturalWidth);
ok(nat > 100, 'map image loaded ' + nat);
await A.screenshot({ path: `${out}/d3-map.png` });
await A.goto(url + '#/schedule'); await A.getByRole('tab', { name: '메인 경기 4종' }).click();
await A.getByRole('button', { name: /단체줄넘기/ }).click(); await A.waitForTimeout(300);
ok(await A.locator('.game-photo img').evaluate((i) => i.naturalWidth > 100), 'game photo loaded');

// 두 번째 탭: 관리자
const B = await ctx.newPage(); B.on('pageerror', (e) => errors.push(e.message));
await B.goto(url); await login(B, '테스트관리자', 'TEST-0002');
await B.getByRole('button', { name: '관리자 화면' }).click();
await B.getByRole('button', { name: /^3조 .*점수 부여/ }).click();
const sh = B.getByRole('dialog');
await sh.getByRole('button', { name: '2. 단체줄넘기' }).click();
await sh.getByRole('button', { name: '100', exact: true }).click();
await sh.getByRole('button', { name: '1위', exact: true }).click();
await sh.getByRole('button', { name: '확인 단계로' }).click();
await sh.getByRole('button', { name: '3조에 100점 부여' }).click();
await B.getByRole('button', { name: '확인' }).click();
ok((await B.getByRole('button', { name: /^3조 .*점수 부여/ }).innerText()).includes('100'), 'board shows 100');
await B.screenshot({ path: `${out}/d4-admin.png` });
ok(!(await A.content()).includes('100점'), 'participant tab has no score');

// 채팅 실시간 (탭 간)
await A.goto(url + '#/chat'); await B.goto(url + '#/chat');
await A.getByLabel('메시지 입력').fill('탭 간 실시간 테스트'); await A.getByRole('button', { name: '보내기' }).click();
await B.getByText('탭 간 실시간 테스트').waitFor({ timeout: 3000 }).then(() => ok(true, 'chat realtime across tabs')).catch(() => ok(false, 'chat realtime across tabs'));
await B.screenshot({ path: `${out}/d5-chat.png` });
// 다른 조 팀채팅 비노출
await A.getByRole('tab', { name: /우리 조/ }).click();
await A.getByLabel('메시지 입력').fill('3조끼리만'); await A.getByRole('button', { name: '보내기' }).click();
await B.getByRole('tab', { name: /우리 조/ }).click(); await B.waitForTimeout(300);
ok((await B.getByText('3조끼리만').count()) === 0, '2조 admin cannot see 3조 team chat');
// 취소
await B.goto(url + '#/admin/log');
await B.getByRole('button', { name: '취소' }).first().click();
const d = B.getByRole('dialog');
await d.getByLabel('취소 사유').fill('데모 취소'); await d.getByLabel('취소 비밀번호').fill('0000');
await d.getByRole('button', { name: /상쇄/ }).click();
await d.getByText('점수는 차감되지 않았습니다').waitFor(); ok(true, 'wrong password rejected');
await d.getByLabel('취소 비밀번호').fill('1234'); await d.getByRole('button', { name: /상쇄/ }).click();
await B.getByText('취소됨').first().waitFor();
ok(true, 'cancel ok');
ok(errors.length === 0, 'no page errors ' + errors.join(' | '));
await browser.close();
