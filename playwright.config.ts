import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests run against an already started portal:
 *   BASE_URL=http://127.0.0.1:8080 ADMIN_LOGIN=admin ADMIN_PASSWORD=<temp> npx playwright test
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:8080',
    locale: 'ru-RU',
    colorScheme: 'dark',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : undefined,
  },
});
