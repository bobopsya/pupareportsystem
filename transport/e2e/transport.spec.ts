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
  expect((await request.post(`${BANK}/api/admin/accounts/${main.id}/adjust`, { headers: H, data: { direction: 'credit', amount: '60000.00', title: 'Зарплата' } })).ok()).toBeTruthy();

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
  // The car came; the passenger gets in and says when they arrived.
  await page.getByRole('button', { name: 'Я сел' }).click();
  await expect(page.getByRole('heading', { name: 'Едем' })).toBeVisible();
  await page.getByRole('button', { name: 'Мы приехали' }).click();
  await expect(page.getByText('Приехали!')).toBeVisible();
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
  // After the ride the map shows the destination: back to where the passenger is.
  await page.getByRole('button', { name: 'Где я' }).click();
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'улица Арбат, 10' }).click();
  await page.getByRole('button', { name: /Вызвать · \d+/ }).click();
  await expect(page.getByText('Ищем машину')).toBeVisible();
  expect(await available(page)).toBeLessThan(mid);
  await page.getByRole('button', { name: 'Отменить поиск' }).click();
  await expect(page.getByText('деньги разморожены')).toBeVisible();
  expect(await available(page)).toBe(mid);

  // A bus of the line from the fixture: the fare is charged at boarding.
  await page.getByRole('tab', { name: 'Автобус' }).click();
  await page.getByRole('button', { name: 'Где я' }).click();
  await page.waitForTimeout(2500);
  // By default the bus tab orders a bus like a taxi; city lines are one tap away.
  await page.getByRole('button', { name: 'улица Арбат, 10' }).click();
  await expect(page.getByRole('button', { name: /Заказать · \d+/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Бизнес-автобус')).toBeVisible();
  await expect(page.getByText('Микроавтобус')).toBeVisible();
  await page.getByRole('button', { name: 'Городской по маршруту' }).click();
  await expect(page.getByRole('button', { name: 'Поехали · 83 ₽' })).toBeVisible({ timeout: 20_000 });
  const beforeBus = await available(page);
  await page.getByRole('button', { name: 'Поехали · 83 ₽' }).click();
  await expect(page.getByText(/Автобус через|Автобус подходит/)).toBeVisible();
  await expect(page.getByText('Автобус на остановке — садитесь!')).toBeVisible({ timeout: 180_000 });
  expect(beforeBus - (await available(page))).toBe(0);
  await page.getByRole('button', { name: 'Я сел · 83 ₽' }).click();
  await expect(page.getByText('Едете в автобусе')).toBeVisible();
  expect(beforeBus - (await available(page))).toBe(83_00);
  await page.getByRole('button', { name: 'Я вышел' }).click();
  await expect(page.getByText('Приехали!')).toBeVisible();
  await page.getByRole('button', { name: /Готово/ }).click();

  // A helicopter above the mandate limit: the customer confirms the amount in the bank app.
  await page.getByRole('tab', { name: 'Вертолёт' }).click();
  await page.getByText('Выберите вертодром').click();
  await page.getByRole('button', { name: /Внуково-3/ }).click();
  const book = page.getByRole('button', { name: /Забронировать · / });
  await expect(book).toBeVisible({ timeout: 15_000 });
  const heliPrice = Number((await book.innerText()).replace(/\D/g, '')) * 100;
  const beforeHeli = await available(page);
  await book.click();
  await expect(page.getByText('Подтвердите оплату в Bobobank')).toBeVisible();
  const href = await page.getByRole('link', { name: /Открыть Bobobank/ }).getAttribute('href');
  const bank = await page.context().newPage();
  await bank.goto(href!);
  await expect(bank.getByText('Бобо.Транспорт')).toBeVisible();
  await bank.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(bank.getByText('Оплата подтверждена')).toBeVisible();
  await bank.close();
  expect(beforeHeli - (await available(page))).toBe(heliPrice);
  await page.getByRole('button', { name: 'Я на борту' }).click({ timeout: 60_000 });
  await expect(page.getByText('В полёте')).toBeVisible();
  await page.getByRole('button', { name: 'Прилетели', exact: true }).click();
  await expect(page.getByText('Прилетели!')).toBeVisible();
  await expect(page.getByText('Оплачено Bobobank')).toBeVisible({ timeout: 10_000 });
  expect(beforeHeli - (await available(page))).toBe(heliPrice);
  await page.getByRole('button', { name: /Готово/ }).click();
  await page.getByRole('tab', { name: 'Такси' }).click();

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
