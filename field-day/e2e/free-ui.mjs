// Netlify 빌드 + Firebase 에뮬레이터로 실제 화면 흐름 검증 (scripts/firebase-ui-test.sh에서 실행)
import { chromium } from '@playwright/test';
const BASE = process.env.BASE ?? 'http://127.0.0.1:4174';
const out = process.env.SHOTS ?? 'e2e/screenshots';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let failed = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) failed++; };
const errors = [];
async function page(w = 390) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  return p;
}
async function login(p, name, emp) {
  await p.goto(BASE + '/');
  await Promise.race([p.getByLabel('이름').waitFor({ timeout: 20000 }), p.locator('.ticket-no').waitFor({ timeout: 20000 })]);
  if (await p.locator('.ticket-no').count()) return; // 이미 이 기기로 입장한 상태
  await p.getByLabel('이름').fill(name); await p.getByLabel('사번').fill(emp);
  await p.getByRole('button', { name: '입장하기' }).click();
  await p.locator('.ticket-no').waitFor({ timeout: 20000 });
}
try {
  // 1. 최초 설정
  const o = await page(1280);
  await o.goto(BASE + '/setup');
  await o.getByLabel('owner 이름').fill('총괄');
  await o.getByLabel('owner 사번').fill('O-1');
  await o.getByRole('button', { name: '설정하기' }).click();
  await o.getByText('설정이 끝났습니다').first().waitFor({ timeout: 20000 });
  ok(true, '/setup에서 owner 등록 (무료 요금제, 서버 함수 없음)');
  // 2. owner 로그인 → 명단 업로드
  await login(o, '총괄', 'O-1');
  ok(true, 'owner 로그인, 행운권 ' + await o.locator('.ticket-no').innerText());
  await o.goto(BASE + '/#/admin/owner');
  const csv = ['사번,이름,조,역할', 'M-1,관리일,2조,admin', 'P-1,참가일,3조,participant', 'P-2,참가오,5조,participant'].join('\n');
  await o.locator('input[type=file]').setInputFiles({ name: 'roster.csv', mimeType: 'text/csv', buffer: Buffer.from('﻿' + csv) });
  await o.getByText('추가 3').first().waitFor({ timeout: 20000 });
  await o.getByText('역할 변경').count();
  await o.getByRole('button', { name: '명단 반영' }).click();
  await o.getByText(/명단 반영: 추가 3/).first().waitFor({ timeout: 20000 });
  ok(true, '명단 CSV 업로드·반영');
  await o.screenshot({ path: `${out}/free-owner.png`, fullPage: true });

  // 3. 참가자 화면
  const p = await page();
  await login(p, '참가일', 'P-1');
  const ticket = (await p.locator('.ticket-no').innerText()).replace(/\D/g, '');
  ok(await p.locator('.ticket-team .big').innerText() === '3조', '참가자 3조 표시');
  ok(!(await p.getByRole('button', { name: '관리자 화면' }).count()), '참가자에게 관리자 버튼 없음');
  await p.screenshot({ path: `${out}/free-pass.png`, fullPage: true });
  await p.goto(BASE + '/#/schedule');
  await p.getByText('퇴근버스 탑승').first().waitFor({ timeout: 15000 });
  const sched = await p.locator('main').innerText();
  ok(sched.includes('17:40') && !/단체줄넘기|튜브릴레이|공 튕기기/.test(sched), '일정: 17:40 퇴근버스, 경기별 세부 없음');
  await p.screenshot({ path: `${out}/free-schedule.png`, fullPage: true });
  await p.goto(BASE + '/#/admin');
  await p.getByText('관리자만 볼 수 있는 화면입니다').first().waitFor();
  ok(true, '참가자 관리자 화면 접근 차단');

  // 4. 관리자: 점수 부여 → owner 화면 실시간 반영, 참가자 미수신
  const a = await page();
  await login(a, '관리일', 'M-1');
  await o.goto(BASE + '/#/admin');
  const card3 = o.getByRole('button', { name: /^3조 .*점수 부여/ });
  await card3.waitFor({ timeout: 15000 });
  await a.getByRole('button', { name: '관리자 화면' }).click();
  await a.getByRole('button', { name: /^3조 .*점수 부여/ }).click();
  const sh = a.getByRole('dialog');
  await sh.getByRole('button', { name: '2. 단체줄넘기' }).click();
  await sh.getByRole('button', { name: '100', exact: true }).click();
  await sh.getByRole('button', { name: '2위', exact: true }).click();
  await sh.getByRole('button', { name: '확인 단계로' }).click();
  await sh.getByRole('button', { name: '3조에 100점 부여' }).click();
  await a.getByText('3조에 100점을 부여했습니다').first().waitFor({ timeout: 20000 });
  await a.getByRole('button', { name: '확인' }).click();
  await o.waitForFunction(() => [...document.querySelectorAll('.team-card')].some((c) => c.textContent?.startsWith('3조') && c.textContent.includes('100')), null, { timeout: 15000 });
  ok(true, '관리자 부여 → 다른 관리자(owner) 점수판 실시간 반영');
  ok(!(await p.content()).includes('100점'), '참가자 화면에 점수 없음');
  // 취소
  await a.goto(BASE + '/#/admin/log');
  await a.getByRole('button', { name: '취소' }).first().click();
  const d = a.getByRole('dialog');
  await d.getByLabel('취소 사유').fill('입력 실수'); await d.getByLabel('취소 비밀번호').fill('0000');
  await d.getByRole('button', { name: /상쇄/ }).click();
  await d.getByText('점수는 차감되지 않았습니다').first().waitFor({ timeout: 15000 });
  await d.getByLabel('취소 비밀번호').fill('1234');
  await d.getByRole('button', { name: /상쇄/ }).click();
  await a.getByText('취소됨').first().waitFor({ timeout: 15000 });
  ok(true, '틀린 비밀번호 거절 → 1234로 취소');
  await a.screenshot({ path: `${out}/free-log.png`, fullPage: true });

  // 5. 행운권 조회
  await a.goto(BASE + '/#/admin/tickets');
  await a.getByLabel('행운권 번호').fill(ticket);
  await a.getByRole('button', { name: '조회' }).click();
  await a.getByText('참가일').first().waitFor({ timeout: 15000 });
  ok((await a.locator('main').innerText()).includes('3조'), `행운권 ${ticket}번 → 참가일 · 3조`);
  await a.screenshot({ path: `${out}/free-tickets.png` });
  await a.getByLabel('행운권 번호').fill('999');
  await a.getByRole('button', { name: '조회' }).click();
  await a.getByText('아직 아무에게도 발급되지 않았습니다').first().waitFor({ timeout: 15000 });
  ok(true, '미발급 번호 안내');

  // 6. 채팅 실시간
  const p5 = await page();
  await login(p5, '참가오', 'P-2');
  await p.goto(BASE + '/#/chat'); await p5.goto(BASE + '/#/chat');
  await p.getByLabel('메시지 입력').fill('전체 방 실시간 테스트');
  await p.getByRole('button', { name: '보내기' }).click();
  await p5.getByText('전체 방 실시간 테스트').first().waitFor({ timeout: 15000 });
  ok(true, '전체 채팅 실시간 전달');
  await p.getByRole('tab', { name: /우리 조/ }).click(); await p5.getByRole('tab', { name: /우리 조/ }).click();
  await p.waitForTimeout(1200);
  await p.getByLabel('메시지 입력').fill('3조끼리만');
  await p.getByRole('button', { name: '보내기' }).click();
  await p.getByText('3조끼리만').first().waitFor();
  await p5.waitForTimeout(1500);
  ok(!(await p5.getByText('3조끼리만').count()), '다른 조(5조)에는 3조 메시지 안 보임');
  await p.screenshot({ path: `${out}/free-chat.png` });
  // 6-1. 스크래치 쿠폰: 관리자 배포 → 참가자 긁기 → 당첨
  await p.goto(BASE + '/#/pass');
  await p.getByText('쿠폰이 잠겨 있어요').first().waitFor({ timeout: 15000 });
  ok(true, '배포 전 쿠폰 잠김');
  await a.goto(BASE + '/#/admin/coupon');
  await a.getByLabel('당첨 개수').fill('5');
  await a.getByRole('button', { name: '쿠폰 배포' }).click();
  await a.getByRole('button', { name: '배포', exact: true }).click();
  await a.getByText(/대상 인원\(2명\)보다 많습니다/).first().waitFor({ timeout: 15000 });
  ok(true, '당첨 개수가 입장 인원보다 많으면 거절');
  await a.getByLabel('당첨 개수').fill('2');
  await a.getByRole('button', { name: '쿠폰 배포' }).click();
  await a.getByRole('button', { name: '배포', exact: true }).click();
  await a.getByText('텀블러 2개').first().waitFor({ timeout: 20000 });
  ok(true, '관리자 텀블러 2개 배포');
  const open = p.getByRole('button', { name: '스크래치 쿠폰 열기' });
  await open.waitFor({ timeout: 20000 });
  ok(true, '배포 → 참가자 메인에 쿠폰 실시간 활성화');
  await p.bringToFront();  // 백그라운드 탭은 애니메이션이 느려짐
  await open.click();
  const card = p.locator('.scratch-card');
  await card.waitFor();
  await p.waitForTimeout(500);
  const bx = await card.boundingBox();
  await p.mouse.move(bx.x + 10, bx.y + 10); await p.mouse.down();
  for (let row = 0; row < 9; row++) for (let i = 0; i <= 10; i++) await p.mouse.move(bx.x + (row % 2 ? 1 - i / 10 : i / 10) * bx.width, bx.y + (row + 0.5) * bx.height / 9, { steps: 2 });
  await p.mouse.up();
  await p.locator('.scratch-card.revealed').waitFor({ timeout: 10000 });
  ok((await p.locator('.scratch-card').innerText()).includes('스페셜 선물 당첨!') && await p.locator('.rainbow-arc').count() === 1, '긁으면 "스페셜 선물 당첨!" + 무지개 효과');
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${out}/free-coupon-win.png` });
  await p.getByRole('button', { name: '확인', exact: true }).click();
  await p.locator('.coupon.won').waitFor({ timeout: 10000 });
  ok(true, '메인 쿠폰이 당첨 상태로 바뀜');
  await p.screenshot({ path: `${out}/free-coupon-card.png` });
  await p5.bringToFront(); await p5.goto(BASE + '/#/pass');
  await p5.getByRole('button', { name: '스크래치 쿠폰 열기' }).click();
  await p5.getByRole('button', { name: '한 번에 열기' }).click();
  await p5.locator('.scratch-card.revealed.is-win').waitFor({ timeout: 10000 });
  ok(true, '"한 번에 열기"로도 확인');
  await a.bringToFront(); await a.reload();
  await a.getByText('당첨자 2명').first().waitFor({ timeout: 15000 });
  await a.getByRole('button', { name: '수령 처리' }).first().click();
  await a.getByText('수령 1명').first().waitFor({ timeout: 15000 });
  ok(true, '관리자 당첨자 목록·수령 처리');
  await a.screenshot({ path: `${out}/free-coupon-admin.png`, fullPage: true });
  await a.getByRole('button', { name: '쿠폰 마감' }).click();
  await a.getByRole('button', { name: '마감하기' }).click();
  await a.getByRole('button', { name: '쿠폰 배포' }).waitFor({ timeout: 15000 });
  ok(true, '쿠폰 마감');
  // 7. 인원 추가 → 바로 입장
  await o.goto(BASE + '/#/admin/checkins');
  await o.getByLabel('이름', { exact: true }).fill('현장추가');
  await o.getByLabel('사번', { exact: true }).fill('900001');
  await o.getByLabel('추가할 사람의 조').selectOption({ label: '운영진' });
  await o.getByRole('button', { name: '명단에 추가' }).click();
  await o.getByText(/현장추가\(운영진\)님을 추가했습니다/).first().waitFor({ timeout: 15000 });
  const n = await page();
  await login(n, '현장추가', '900001');
  ok(await n.locator('.ticket-team .big').innerText() === '운영진', '관리자 화면에서 추가한 사람이 바로 입장 (운영진)');
  await o.screenshot({ path: `${out}/free-addperson.png`, fullPage: true });

  // 8. 행운권 초기화 → 다시 열면 새 번호
  await o.goto(BASE + '/#/admin/owner');
  await o.getByRole('button', { name: '행운권 초기화…' }).click();
  const r = o.getByRole('dialog');
  await r.getByLabel(/확인 문구/).fill('초기화');
  await r.getByLabel('점수 취소 비밀번호').fill('1234');
  await r.getByRole('button', { name: '모든 행운권 초기화' }).click();
  await o.getByText(/행운권 \d+장을 초기화했습니다/).first().waitFor({ timeout: 30000 });
  ok(true, 'owner 화면에서 행운권 초기화');
  await p.goto(BASE + '/#/pass'); await p.reload();
  await p.locator('.ticket-no').waitFor({ timeout: 20000 });
  ok(/No\.\d{3}/.test(await p.locator('.ticket-no').innerText()), '초기화 후 참가자가 앱을 다시 열면 새 번호 표시');
} catch (e) {
  failed++; console.log('  ✗ 예외:', e.message.split('\n')[0]);
}
ok(errors.length === 0, '페이지 오류 없음 ' + errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failed ? `실패 ${failed}` : '모두 통과');
process.exit(failed ? 1 : 0);
