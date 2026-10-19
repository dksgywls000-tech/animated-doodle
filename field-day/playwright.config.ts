import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3100',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    launchOptions: process.env.CHROMIUM_PATH || process.env.CI ? {} : { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' },
  },
  webServer: {
    command: 'npm run build && bash scripts/e2e-server.sh',
    url: 'http://localhost:3100/api/health',
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
