import { expect, request as pwRequest, test, type APIRequestContext, type Page } from '@playwright/test';

const BANK = process.env.BANK_URL ?? 'http://localhost:8082';
const GPAY = process.env.GPAY_URL ?? 'http://localhost:8081';
const PHONE = `79${String(Date.now()).slice(-9)}`;
const H = { 'x-requested-with': 'bobobank' };

test.describe.configure({ mode: 'serial' });

async function bankAdmin(request: APIRequestContext) {
  const r = await request.post(`${BANK}/api/auth/login`, { headers: H, data: { phone: process.env.BANK_ADMIN_PHONE, password: process.env.BANK_ADMIN_PASSWORD } });
  expect(r.ok(), 'BANK_ADMIN_PHONE / BANK_ADMIN_PASSWORD must point to a bank admin').toBeTruthy();
}

/** GPAY merchant with a shop and an API key, created over the cabinet API. */
async function gpayMerchant(request: APIRequestContext) {
  const g = { 'x-requested-with': 'gpay' };
  await request.post(`${GPAY}/api/auth/register`, { headers: g, data: { email: `bank-e2e-${Date.now()}@shop.test`, name: 'Продавец', password: 'password123' } });
  const shop = (await (await request.post(`${GPAY}/api/m/shops`, { headers: g, data: { name: 'Кофейня «Бобо»', legalName: 'ООО «Бобо»', inn: '7700000001', taxSystem: 'usn_income', site: 'bobo.coffee' } })).json()).shop;
  const key = (await (await request.post(`${GPAY}/api/m/shops/${shop.id}/keys`, { headers: g, data: { name: 'e2e' } })).json()).secret as string;
  const pay = async (value: string) =>
    (await request.post(`${GPAY}/api/v1/payments`, { headers: { Authorization: `Bearer ${key}`, 'Idempotence-Key': `e2e-${Date.now()}-${Math.random()}` }, data: { amount: { value, currency: 'RUB' }, description: 'Капучино и круассан', confirmation: { type: 'redirect', return_url: `${GPAY}/` } } })).json();
  return { shopId: shop.id as number, key, pay, g };
}

async function balance(page: Page) {
  const home = await (await page.request.get(`${BANK}/api/home`)).json();
  return home.accounts[0].balance as number;
}

test('bank customer pays a GPAY order with a Bobobank card, confirms it in the app, gets a refund; shop is paid out to the bank', async ({ page, request, context }) => {
  // Register in the bank: the SMS code arrives as an on-screen notification.
  await page.goto(`${BANK}/register`);
  await page.getByLabel('Номер телефона').fill(PHONE.slice(1));
  await page.getByRole('button', { name: 'Получить код' }).click();
  await page.getByText('Код для входа в Bobobank').click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByLabel('Имя и фамилия').fill('Тест Бобов');
  await page.getByLabel('Дата рождения').fill('1995-05-20');
  await page.getByLabel('Придумайте пароль').fill('password123');
  await page.getByRole('button', { name: 'Открыть счёт' }).click();
  await expect(page.getByText('Последние операции')).toBeVisible();

  // Salary from the bank admin.
  await bankAdmin(request);
  const home = await (await page.request.get(`${BANK}/api/home`)).json();
  const main = home.accounts[0];
  expect((await request.post(`${BANK}/api/admin/accounts/${main.id}/adjust`, { headers: H, data: { direction: 'credit', amount: '10000.00', title: 'Зарплата' } })).ok()).toBeTruthy();
  const card = await (await page.request.post(`${BANK}/api/cards/${home.cards[0].id}/reveal`, { headers: H, data: {} })).json();

  // A GPAY order paid with the Bobobank card.
  const m = await gpayMerchant(request);
  const p1 = await m.pay('1290.00');
  const checkout = await context.newPage();
  await checkout.goto(`${GPAY}/pay/${p1.id}`);
  await checkout.locator('#cc-number').fill(card.pan);
  await checkout.locator('#cc-exp').fill(card.exp.replace('/', ''));
  await checkout.locator('#cc-csc').fill(card.cvc);
  await checkout.getByRole('button', { name: /Оплатить/ }).click();
  await expect(checkout.getByText('Подтвердите покупку в приложении Bobobank')).toBeVisible();

  // The bank app shows the request over any screen.
  await page.bringToFront();
  await page.reload();
  const sheet = page.getByRole('dialog', { name: 'Подтверждение покупки' });
  await expect(sheet.getByText('Кофейня «Бобо»')).toBeVisible({ timeout: 10_000 });
  await sheet.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(checkout.getByText('Оплата прошла успешно')).toBeVisible({ timeout: 15_000 });
  expect(await balance(page)).toBe(1_000_000 - 129_000);

  // Refund from the GPAY cabinet goes back to the card.
  const ref = await request.post(`${GPAY}/api/v1/refunds`, { headers: { Authorization: `Bearer ${m.key}`, 'Idempotence-Key': `rf-${Date.now()}` }, data: { payment_id: p1.id, amount: { value: '290.00', currency: 'RUB' } } });
  expect(ref.ok()).toBeTruthy();
  expect(await balance(page)).toBe(1_000_000 - 100_000);

  // Business account linked to the shop; bank money paid out to it.
  const biz = (await (await page.request.post(`${BANK}/api/accounts`, { headers: H, data: { kind: 'business', businessType: 'ip', legalName: 'Бобов Тест Тестович', inn: '771234567890' } })).json()).account;
  await page.goto(`${BANK}/app/accounts/${biz.id}`);
  await page.getByRole('button', { name: 'Подключить магазин GPAY' }).click();
  const code = (await page.locator('button.tracking-\\[0\\.12em\\]').textContent())!.trim();
  expect(code).toMatch(/^\d{4}-\d{4}$/);
  const linked = await request.post(`${GPAY}/api/m/shops/${m.shopId}/bank-link`, { headers: m.g, data: { code } });
  expect(linked.ok()).toBeTruthy();
  const po = await request.post(`${GPAY}/api/m/shops/${m.shopId}/payouts`, { headers: m.g, data: { amount: '900.00', currency: 'RUB', destination: 'bobobank' } });
  expect((await po.json()).payout.status).toBe('succeeded');
  await page.reload();
  await expect(page.getByText('Выплата выручки «Кофейня «Бобо»»').first()).toBeVisible();
});

test('SBP from the bank app pays a GPAY order', async ({ page, request }) => {
  await page.goto(`${BANK}/login`);
  await page.getByLabel('Телефон').fill(PHONE.slice(1));
  await page.getByLabel('Пароль').fill('password123');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByText('Последние операции')).toBeVisible();
  const m = await gpayMerchant(request);
  const p = await m.pay('150.00');
  const before = await balance(page);

  // The SBP QR on the checkout points to the bank's page for this order.
  await page.goto(`${GPAY}/pay/${p.id}`);
  await page.getByRole('tab', { name: /СБП/ }).click();
  const link = page.getByRole('link', { name: 'Открыть Bobobank' });
  await expect(link).toHaveAttribute('href', new RegExp(`/sbp/pay\\?payment=${p.id}$`));
  await page.goto((await link.getAttribute('href'))!);
  await expect(page.getByText('Кофейня «Бобо»')).toBeVisible();
  await page.getByRole('button', { name: /Оплатить/ }).click();
  await expect(page.getByText('Оплачено через СБП')).toBeVisible();
  expect(await balance(page)).toBe(before - 15_000);
  const status = await (await request.get(`${GPAY}/api/v1/payments/${p.id}`, { headers: { Authorization: `Bearer ${m.key}` } })).json();
  expect(status).toMatchObject({ status: 'succeeded', test: false, payment_method: { type: 'sbp' } });
});

async function login(page: Page) {
  await page.goto(`${BANK}/login`);
  await page.getByLabel('Телефон').fill(PHONE.slice(1));
  await page.getByLabel('Пароль').fill('password123');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByText('Последние операции')).toBeVisible();
}

test('the Bobo Pay button on the GPAY checkout pays from the bank app', async ({ page, request }) => {
  await login(page);
  const m = await gpayMerchant(request);
  const p = await m.pay('99.00');
  const before = await balance(page);
  await page.goto(`${GPAY}/pay/${p.id}`);
  await page.getByRole('tab', { name: /Bobo Pay/ }).click();
  await page.getByRole('link', { name: 'Bobo Pay' }).click();
  await expect(page.getByText('Кофейня «Бобо»')).toBeVisible();
  await page.getByRole('button', { name: /Оплатить/ }).click();
  await expect(page.getByText('Оплачено через Bobo Pay')).toBeVisible();
  expect(await balance(page)).toBe(before - 9_900);
  // Back to the GPAY page on its own, and from there on to the shop's return page.
  await expect(page).toHaveURL(new RegExp(`/pay/${p.id}\\?from=bank$`), { timeout: 10_000 });
  await expect(page.getByText('Оплата прошла успешно')).toBeVisible();
  await expect(page).toHaveURL(`${GPAY}/`, { timeout: 10_000 });
  const status = await (await request.get(`${GPAY}/api/v1/payments/${p.id}`, { headers: { Authorization: `Bearer ${m.key}` } })).json();
  expect(status).toMatchObject({ status: 'succeeded', test: false, payment_method: { type: 'bobopay' } });
});

test('a recent recipient opens the transfer with the number filled in, and can be kept in favourites', async ({ page }) => {
  // A friend in the bank, and a transfer to them with a message (the message used to hide the number).
  const friendPhone = `79${String(Date.now() + 3).slice(-9)}`;
  const friend = await pwRequest.newContext({ baseURL: BANK, extraHTTPHeaders: H });
  const { code } = await (await friend.post('/api/auth/code', { data: { phone: friendPhone } })).json();
  expect((await friend.post('/api/auth/register', { data: { phone: friendPhone, code, name: 'Друг Бобов', birthDate: '1994-03-03', password: 'password123' } })).ok()).toBeTruthy();
  await login(page);
  const home = await (await page.request.get(`${BANK}/api/home`)).json();
  const sent = await page.request.post(`${BANK}/api/transfers`, { headers: H, data: { fromAccountId: home.accounts[0].id, recipient: { type: 'phone', phone: friendPhone }, amount: '50.00', comment: 'За кофе' } });
  expect(sent.ok()).toBeTruthy();

  await page.goto(`${BANK}/app/payments`);
  await page.getByRole('button', { name: 'Друг Б.' }).first().click();
  await expect(page.getByLabel('Номер телефона получателя')).toHaveValue(new RegExp(friendPhone.slice(-2) + '$'));
  await page.getByLabel('Сумма').fill('10');
  await page.getByRole('button', { name: /Перевести/ }).click();
  await expect(page.getByText('Перевод отправлен')).toBeVisible();
  await page.getByRole('button', { name: 'Добавить в избранное' }).click();
  await expect(page.getByRole('button', { name: 'В избранном' })).toBeVisible();

  await page.goto(`${BANK}/app/payments`);
  await expect(page.getByText('Избранное')).toBeVisible();
  await page.getByRole('button', { name: 'Друг Б.' }).first().click();
  await expect(page.getByLabel('Номер телефона получателя')).toHaveValue(new RegExp(friendPhone.slice(-2) + '$'));
  await expect(page.getByLabel('Сумма')).toHaveValue('10');
});
