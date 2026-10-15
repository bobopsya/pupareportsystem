import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests run against started GPAY and Bobobank servers connected to each other (from the repository root):
 *   BASE_URL=http://localhost:8081 BANK_URL=http://localhost:8082 BANK_ADMIN_PHONE=79990000001 BANK_ADMIN_PASSWORD=… \
 *   npx playwright test -c gpay/playwright.config.ts
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:8081',
    locale: 'ru-RU',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : undefined,
  },
});
