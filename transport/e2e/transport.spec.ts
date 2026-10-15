import { expect, test, type Page } from '@playwright/test';

const TAXI = process.env.TAXI_URL ?? 'http://localhost:8084';
const BANK = process.env.BANK_URL ?? 'http://localhost:8082';
const PHONE = `79${String(Date.now()).slice(-9)}`;
const H = { 'x-requested-with': 'bobobank' };
// 1×1 PNG instead of OpenStreetMap tiles: tests don't load the public tile servers.
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');

test.describe.configure({ mode: 'serial' });

async function available(page: Page) {
  const home = await (await page.request.get(`${BANK}/api/home`)).json();
  return home.accounts[0].available as number;
}

test('вход через Bobobank, поездка по Москве, списание точной цены и отмена с разморозкой', async ({ page, request }) => {
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: TILE }));

  // A bank customer with money.
  await page.goto(`${BANK}/register`);
  await page.getByLabel('Номер телефона').fill(PHONE.slice(1));
  await page.getByRole('button', { name: 'Получить код' }).click();
  await page.getByText('Код для входа в Bobobank').click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByLabel('Имя и фамилия').fill('Пётр Такси');
  await page.getByLabel('Дата рождения').fill('1990-01-15');
  await page.getByLabel('Придумайте пароль').fill('password123');
  await page.getByRole('button', { name: 'Открыть счёт' }).click();
  await expect(page.getByText('Последние операции')).toBeVisible();
  const r = await request.post(`${BANK}/api/auth/login`, { headers: H, data: { phone: process.env.BANK_ADMIN_PHONE, password: process.env.BANK_ADMIN_PASSWORD } });
  expect(r.ok(), 'BANK_ADMIN_PHONE / BANK_ADMIN_PASSWORD must point to a bank admin').toBeTruthy();
  const main = (await (await page.request.get(`${BANK}/api/home`)).json()).accounts[0];
  expect((await request.post(`${BANK}/api/admin/accounts/${main.id}/adjust`, { headers: H, data: { direction: 'credit', amount: '3000.00', title: 'Зарплата' } })).ok()).toBeTruthy();

  // «Войти через Bobobank»: consent in the bank, back to the taxi.
  await page.goto(TAXI);
  await page.getByRole('button', { name: 'Войти через Bobobank' }).last().click();
  await expect(page.getByText('получит ваше имя и сможет списывать')).toBeVisible();
  await page.getByRole('button', { name: 'Разрешить' }).click();
  await page.waitForURL(`${TAXI}/`);
  await expect(page.getByText('Счёт Bobobank привязан')).toBeVisible();

  // Route and prices.
  await page.getByText('Куда едем?').click();
  await page.getByPlaceholder('Куда едем?').fill('Арбат 10');
  await page.getByRole('button', { name: /улица Арбат, 10/ }).first().click();
  const call = page.getByRole('button', { name: /Вызвать · \d+/ });
  await expect(call).toBeVisible({ timeout: 20_000 });
  const price = Number((await call.innerText()).replace(/\D/g, '')) * 100;
  const before = await available(page);
  await call.click();
  await expect(page.getByText('Ищем машину')).toBeVisible();
  expect(before - (await available(page))).toBe(Math.ceil((price * 1.2) / 100) * 100);

  // The car comes, the passenger gets in, the ride ends: exactly the price is charged.
  await expect(page.getByText(/Приедет через|подъезжает/)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.bt-car')).toBeVisible();
  await expect(page.getByText('Машина на месте')).toBeVisible({ timeout: 180_000 });
  await page.getByRole('button', { name: 'Я в машине, поехали' }).click();
  await expect(page.getByText('В пути')).toBeVisible();
  await expect(page.getByText('Приехали!')).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText('Оплачено Bobobank')).toBeVisible({ timeout: 10_000 });
  expect(before - (await available(page))).toBe(price);
  await page.getByRole('button', { name: '5 из 5' }).click();
  await page.getByRole('button', { name: '30 ₽' }).click();
  await page.getByRole('button', { name: /Готово/ }).click();
  await expect(page.getByText('чаевых отправлены')).toBeVisible();
  expect(before - (await available(page))).toBe(price + 30_00);

  // In the bank: the ride and the tip with the service name.
  const ops = await (await page.request.get(`${BANK}/api/history`)).json();
  expect(JSON.stringify(ops)).toContain('Бобо.Транспорт');

  // A new order cancelled before the car arrives: the hold is released in full.
  // The last destination is offered on the main screen.
  const mid = await available(page);
  await page.getByRole('button', { name: 'улица Арбат, 10' }).click();
  await page.getByRole('button', { name: /Вызвать · \d+/ }).click();
  await expect(page.getByText('Ищем машину')).toBeVisible();
  expect(await available(page)).toBeLessThan(mid);
  await page.getByRole('button', { name: 'Отменить поиск' }).click();
  await expect(page.getByText('деньги разморожены')).toBeVisible();
  expect(await available(page)).toBe(mid);

  // History and receipt.
  await page.goto(`${TAXI}/rides`);
  await expect(page.getByText('улица Арбат, 10').first()).toBeVisible();
  const list = await (await page.request.get(`${TAXI}/api/rides`)).json();
  const done = list.rides.find((x: { status: string }) => x.status === 'completed');
  const pdf = await page.request.get(`${TAXI}/api/rides/${done.id}/receipt.pdf`);
  expect(pdf.headers()['content-type']).toBe('application/pdf');

  // Profile in the bank: the connected service can be switched off.
  await page.goto(`${BANK}/app/profile`);
  await expect(page.getByText('Подключённые сервисы')).toBeVisible();
  await page.getByText('Бобо.Транспорт').click();
  await page.getByRole('button', { name: 'Отключить сервис' }).click();
  await expect(page.getByText('Бобо.Транспорт отключён')).toBeVisible();
  const acc = await (await page.request.get(`${TAXI}/api/me/account`)).json();
  expect(acc.linked).toBe(false);
});
