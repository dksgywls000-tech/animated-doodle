import { test, expect, type Page, type Browser } from '@playwright/test';

const SHOTS = 'e2e/screenshots';

async function login(page: Page, name: string, emp: string) {
  await page.goto('/');
  await page.getByLabel('이름').fill(name);
  await page.getByLabel('사번').fill(emp);
  await page.getByRole('button', { name: '입장하기' }).click();
}

async function newSession(browser: Browser, width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  return { ctx, page: await ctx.newPage() };
}

test('잘못된 이름·사번은 일반 문구로 거절', async ({ page }) => {
  await login(page, '테스트참가자 가', 'TEST-9999');
  await expect(page.getByRole('alert')).toHaveText('이름과 사번을 확인해 주세요. 계속 안 되면 운영진에게 문의해 주세요.');
  await login(page, '테스트비활성', 'TEST-0014');
  await expect(page.getByRole('alert')).toBeVisible();
});

test('참가자: 조·행운권 표시, 새로고침해도 번호 유지, 관리자 버튼·점수 없음', async ({ page }) => {
  await login(page, '테스트참가자 다', 'TEST-0005');
  await expect(page.locator('.ticket-team .big')).toHaveText('3조');
  const no = await page.locator('.ticket-no').innerText();
  expect(no).toMatch(/No\.\d{3}/);
  await page.reload();
  await expect(page.locator('.ticket-no')).toHaveText(no);
  await expect(page.getByRole('button', { name: '관리자 화면' })).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toMatch(/점수판|순위/);
  await page.getByRole('button', { name: '행운권 크게 보기' }).click();
  await expect(page.getByRole('dialog', { name: '행운권 크게 보기' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/#/admin');
  await expect(page.getByText('관리자만 볼 수 있는 화면입니다')).toBeVisible();
  // 앞자리 0 사번 로그인
  await page.goto('/#/pass');
  await page.getByRole('button', { name: '로그아웃' }).click();
  await expect(page.getByRole('button', { name: '입장하기' })).toBeVisible();
  await page.waitForLoadState('load');
  await expect(page.locator('.ticket')).toHaveCount(0);
  await login(page, '테스트영시작', '000123');
  await expect(page.locator('.ticket-team .big')).toHaveText('4조');
});

test('관리자 점수 부여 → 다른 관리자 화면 실시간 갱신 → 취소(비밀번호) / 참가자는 점수 미수신', async ({ browser }) => {
  const a = await newSession(browser);
  const b = await newSession(browser, 1440);
  const p = await newSession(browser);
  await login(a.page, '테스트관리자', 'TEST-0002');
  await login(b.page, '테스트총괄', 'TEST-0001');
  await login(p.page, '테스트참가자 다', 'TEST-0005');
  const wsFrames: string[] = [];
  p.page.on('websocket', (ws) => ws.on('framereceived', (f) => wsFrames.push(String(f.payload))));
  await p.page.reload();

  await a.page.getByRole('button', { name: '관리자 화면' }).click();
  await b.page.goto('/#/admin');
  const card3 = b.page.getByRole('button', { name: /^3조 .*점수 부여/ });
  await expect(card3).toContainText('0');

  await a.page.getByRole('button', { name: /^3조 .*점수 부여/ }).click();
  const sheet = a.page.getByRole('dialog');
  await expect(sheet.locator('.wheel-item.sel')).toHaveText('점수 선택');
  await sheet.getByRole('button', { name: '2. 단체줄넘기' }).click();
  // 휠 키보드 조작: 10 → 20 … 100 (10번 아래)
  await sheet.getByRole('listbox').focus();
  for (let i = 0; i < 10; i++) await a.page.keyboard.press('ArrowDown');
  await expect(sheet.locator('.wheel-item.sel')).toHaveText('+100');
  await sheet.getByRole('button', { name: '2위', exact: true }).click();
  await a.page.screenshot({ path: `${SHOTS}/390-award-filled.png` });
  await sheet.getByRole('button', { name: '확인 단계로' }).click();
  await expect(sheet).toContainText('단체줄넘기 2위');
  await expect(sheet).toContainText('테스트관리자');
  await a.page.screenshot({ path: `${SHOTS}/390-award-confirm.png` });
  await sheet.getByRole('button', { name: '3조에 100점 부여' }).click();
  await expect(a.page.getByText('3조에 100점을 부여했습니다')).toBeVisible();
  await a.page.getByRole('button', { name: '확인' }).click();

  // 다른 관리자 화면에 실시간 반영
  await expect(card3).toContainText('100');
  await b.page.screenshot({ path: `${SHOTS}/1440-admin-board.png`, fullPage: true });

  // 이벤트 점수 + 빠른 칩
  await a.page.getByRole('button', { name: /^5조 .*점수 부여/ }).click();
  await sheet.getByRole('button', { name: '이벤트 게임' }).click();
  await sheet.getByRole('button', { name: '제기차기' }).click();
  await sheet.getByRole('button', { name: '50', exact: true }).click();
  await sheet.getByRole('button', { name: '합산보다 많이 찬 선수 1명' }).click();
  await sheet.getByRole('button', { name: '확인 단계로' }).click();
  await sheet.getByRole('button', { name: '5조에 50점 부여' }).click();
  await a.page.getByRole('button', { name: '확인' }).click();

  // 취소: 틀린 비밀번호 → 변화 없음, 맞는 비밀번호 → 상쇄
  await b.page.getByRole('button', { name: '점수 기록' }).click();
  const row = b.page.locator('tr', { hasText: '단체줄넘기 2위' });
  await row.getByRole('button', { name: '취소' }).click();
  const dlg = b.page.getByRole('dialog');
  await dlg.getByLabel('취소 사유').fill('조 번호 입력 실수');
  await dlg.getByLabel('취소 비밀번호').fill('9999');
  await dlg.getByRole('button', { name: /취소하고 100점 상쇄/ }).click();
  await expect(dlg.getByRole('alert')).toContainText('점수는 차감되지 않았습니다');
  await dlg.getByLabel('취소 비밀번호').fill('1234');
  await dlg.getByRole('button', { name: /취소하고 100점 상쇄/ }).click();
  await expect(row).toContainText('취소됨');
  await expect(row).toContainText('테스트총괄');
  await b.page.screenshot({ path: `${SHOTS}/1440-admin-log.png`, fullPage: true });
  await b.page.getByRole('button', { name: '점수판' }).click();
  await expect(b.page.getByRole('button', { name: /^3조 .*점수 부여/ })).toContainText('0');

  // 참가자 세션은 점수 관련 데이터를 한 바이트도 받지 않았다
  await p.page.waitForTimeout(500);
  expect(wsFrames.join('\n')).not.toMatch(/scores_changed|total|points|rank/);
  expect(await p.page.content()).not.toMatch(/단체줄넘기 2위|100점/);
  await Promise.all([a.ctx.close(), b.ctx.close(), p.ctx.close()]);
});

test('전체·팀 채팅 실시간, 다른 조에는 팀 메시지 미표시', async ({ browser }) => {
  const s3 = await newSession(browser);
  const s3b = await newSession(browser);
  const s5 = await newSession(browser);
  await login(s3.page, '테스트참가자 다', 'TEST-0005');
  await login(s3b.page, '테스트동명', 'TEST-0011');
  await login(s5.page, '테스트동명', 'TEST-0012');
  for (const s of [s3, s3b, s5]) await s.page.getByRole('button', { name: '채팅' }).click();
  await expect(s3.page.getByText('실시간 연결됨')).toBeVisible();

  await s3.page.getByLabel('메시지 입력').fill('<b>모두</b> 반가워요');
  await s3.page.getByRole('button', { name: '보내기' }).click();
  await expect(s5.page.getByText('<b>모두</b> 반가워요')).toBeVisible();

  await s3.page.getByRole('tab', { name: /우리 조/ }).click();
  await s3b.page.getByRole('tab', { name: /우리 조/ }).click();
  await s5.page.getByRole('tab', { name: /우리 조/ }).click();
  await s3.page.getByLabel('메시지 입력').fill('3조 작전회의');
  await s3.page.getByRole('button', { name: '보내기' }).click();
  await expect(s3b.page.getByText('3조 작전회의')).toBeVisible();
  await s5.page.waitForTimeout(600);
  await expect(s5.page.getByText('3조 작전회의')).toHaveCount(0);
  await s3b.page.screenshot({ path: `${SHOTS}/390-chat.png` });
  await Promise.all([s3.ctx.close(), s3b.ctx.close(), s5.ctx.close()]);
});

test('오프라인 표시와 재연결', async ({ browser }) => {
  const s = await newSession(browser);
  await login(s.page, '테스트참가자 라', 'TEST-0006');
  await expect(s.page.locator('.ticket-no')).toBeVisible();
  await s.ctx.setOffline(true);
  await s.page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(s.page.getByText('오프라인입니다')).toBeVisible();
  await s.ctx.setOffline(false);
  await s.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(s.page.getByText('오프라인입니다')).toHaveCount(0);
  await s.ctx.close();
});

test('반응형 스크린샷 360/390/430/768/1440 — 가로 스크롤 없음, 탭바와 CTA 비겹침', async ({ browser }) => {
  for (const w of [360, 390, 430, 768, 1440]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w > 1000 ? 900 : 800 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.screenshot({ path: `${SHOTS}/${w}-login.png` });
    await login(page, '테스트관리자', 'TEST-0002');
    await expect(page.locator('.ticket-no')).toBeVisible();
    for (const route of ['/pass', '/schedule', '/map/seat', '/chat', '/admin']) {
      await page.goto('/#' + route);
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${w} ${route}`).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${SHOTS}/${w}-${route.replace(/\//g, '_')}.png`, fullPage: route !== '/chat' });
    }
    await page.goto('/#/pass');
    const cta = await page.getByRole('button', { name: '관리자 화면' }).boundingBox();
    const tab = await page.locator('.tabbar').boundingBox();
    expect(cta!.y + cta!.height).toBeLessThanOrEqual(tab!.y + 1);
    const tapTargets = await page.locator('.tab, .btn').evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent).map((e) => e.getBoundingClientRect().height));
    expect(Math.min(...tapTargets)).toBeGreaterThanOrEqual(40);
    await ctx.close();
  }
});

test('지도 확대 보기: 열기·확대·닫기', async ({ page }) => {
  await login(page, '테스트참가자 마', 'TEST-0007');
  await page.getByRole('button', { name: '내 조 자리' }).click();
  await expect(page.getByRole('heading', { name: '5조 자리' })).toBeVisible();
  await page.getByRole('button', { name: /크게 보기/ }).click();
  const v = page.getByRole('dialog', { name: '조별 자리 배치도' });
  await expect(v).toBeVisible();
  await v.getByRole('button', { name: '확대' }).click();
  await page.screenshot({ path: `${SHOTS}/390-map-zoom.png` });
  await v.getByRole('button', { name: '닫기' }).click();
  await expect(v).toHaveCount(0);
});

test('공개 번들·정적 경로에 내부 자료·비밀번호 없음', async ({ request }) => {
  expect((await request.get('/assets/10_staff_schedule.png')).status()).toBe(404);
  expect((await request.get('/assets/10_staff_schedule.jpg')).status()).toBe(404);
  const html = await (await request.get('/')).text();
  const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
  for (const s of scripts) {
    const js = await (await request.get(s)).text();
    expect(js).not.toContain('scrypt$');
    expect(js).not.toMatch(/TEST-00\d\d/);
  }
  const me = await request.get('/api/me');
  expect(me.status()).toBe(401);
  expect(me.headers()['cache-control']).toContain('no-store');
});
