import { chromium, devices } from '@playwright/test';
const [login, pw] = process.argv.slice(2);
const SP = process.env.SP;
const browser = await chromium.launch();
const base = 'http://127.0.0.1:8080';
const H = { 'X-Requested-With': 'zhukonet' };
for (const [name, opts] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['mobile', devices['iPhone 13']]]) {
  const ctx = await browser.newContext({ ...opts, locale: 'ru-RU', colorScheme: 'dark' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(name, 'PAGEERROR', e.message));
  await page.goto(base);
  const r = await page.request.post(base + '/api/auth/login', { headers: H, data: { login, password: name === 'desktop' ? pw : 'Correct-Horse-42!' } });
  if (name === 'desktop') {
    await page.request.post(base + '/api/auth/change-password', { headers: H, data: { currentPassword: pw, newPassword: 'Correct-Horse-42!' } });
    // messy real-world data
    await page.request.post(base + '/api/clients', { headers: H, data: { fullName: 'Без координат' } });
    await page.request.post(base + '/api/clients', { headers: H, data: { fullName: 'С координатами', lat: 55.7, lng: 37.6 } });
    await page.request.post(base + '/api/wifi-networks', { headers: H, data: { name: 'Home', lat: 55.71, lng: 37.61 } });
    await page.request.post(base + '/api/wifi-networks', { headers: H, data: { name: 'NoGeo' } });
    await page.request.post(base + '/api/routes', { headers: H, data: { name: 'Пустой' } });
    await page.request.post(base + '/api/routes', { headers: H, data: { name: 'Одна точка', points: [{ lat: 55.7, lng: 37.6, label: '', note: '' }] } });
  }
  await page.goto(base + '/tasks');
  await page.waitForTimeout(800);
  const btn = page.getByRole('main').getByRole('button', { name: 'Добавить', exact: true });
  console.log(name, 'tasks add btn visible', await btn.isVisible(), 'enabled', await btn.isEnabled());
  await page.getByPlaceholder('Новая задача…').fill(`Задача ${name}`);
  try { await btn.click({ timeout: 3000 }); } catch (e) { console.log(name, 'CLICK FAIL', e.message.split('\n').slice(0, 6).join(' | ')); }
  await page.waitForTimeout(800);
  console.log(name, 'task added', await page.getByText(`Задача ${name}`).count());
  await page.screenshot({ path: `${SP}/tasks-${name}.png` });
  for (const url of ['/map', '/wifi', '/routes']) {
    await page.goto(base + url);
    await page.waitForTimeout(1500);
    if (url === '/wifi') { await page.getByText('Карта', { exact: true }).first().click().catch(() => {}); await page.waitForTimeout(800); }
    console.log(name, url, 'leaflet', await page.locator('.leaflet-container').count(), 'body', (await page.locator('main').innerText().catch(() => 'NO MAIN')).slice(0, 80).replace(/\n/g, ' / '));
    await page.screenshot({ path: `${SP}/map-${name}${url.replace('/', '-')}.png` });
  }
  await ctx.close();
}
await browser.close();
