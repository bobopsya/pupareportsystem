import { defineConfig } from '@playwright/test';

/**
 * End-to-end: Бобтелеком with a started Bobobank (from the repository root):
 *   TELECOM_URL=http://localhost:8085 BANK_URL=http://localhost:8082 BANK_ADMIN_PHONE=79990000001 BANK_ADMIN_PASSWORD=… \
 *   npx playwright test -c telecom/playwright.config.ts
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 300_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.TELECOM_URL ?? 'http://localhost:8085',
    locale: 'ru-RU',
    viewport: { width: 390, height: 844 },
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : undefined,
  },
});
