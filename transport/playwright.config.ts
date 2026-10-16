import { defineConfig } from '@playwright/test';

/**
 * End-to-end: Бобо.Транспорт with a started Bobobank (from the repository root):
 *   node transport/e2e/fake-osm.mjs 8099 &
 *   (the taxi server runs with OSRM_URL=NOMINATIM_URL=http://127.0.0.1:8099, BUS_ROUTES_FILE=transport/e2e/bus-fixture.json
 *   and TIME_SCALE=6 AIR_TIME_SCALE=30 — by default time is real and a flight would take hours)
 *   TAXI_URL=http://localhost:8084 BANK_URL=http://localhost:8082 BANK_ADMIN_PHONE=79990000001 BANK_ADMIN_PASSWORD=… \
 *   npx playwright test -c transport/playwright.config.ts
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 600_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.TAXI_URL ?? 'http://localhost:8084',
    locale: 'ru-RU',
    viewport: { width: 390, height: 844 },
    geolocation: { latitude: 55.7575, longitude: 37.6156 },
    permissions: ['geolocation'],
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : undefined,
  },
});
