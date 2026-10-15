import { expect, request as pwRequest, test, type APIRequestContext } from '@playwright/test';

/**
 * GPAY accepts only Bobobank money, so these tests need a running bank connected to GPAY:
 * BANK_URL, BANK_ADMIN_PHONE and BANK_ADMIN_PASSWORD (see bobobank/playwright.config.ts).
 */
const EMAIL = `e2e-${Date.now()}@shop.test`;
const BANK = process.env.BANK_URL ?? 'http://localhost:8082';
const BANK_H = { 'x-requested-with': 'bobobank' };
const PHONE = `79${String(Date.now() + 7).slice(-9)}`;

test.describe.configure({ mode: 'serial' });

/** A bank customer with 10 000 ₽ on the main account, driven over the bank's API. */
async function bankCustomer(): Promise<APIRequestContext> {
  const admin = await pwRequest.newContext({ baseURL: BANK, extraHTTPHeaders: BANK_H });
  expect((await admin.post('/api/auth/login', { data: { phone: process.env.BANK_ADMIN_PHONE, password: process.env.BANK_ADMIN_PASSWORD } })).ok(), 'BANK_ADMIN_PHONE / BANK_ADMIN_PASSWORD must point to a bank admin').toBeTruthy();
  const bank = await pwRequest.newContext({ baseURL: BANK, extraHTTPHeaders: BANK_H });
  let login = await bank.post('/api/auth/login', { data: { phone: PHONE, password: 'password123' } });
  if (!login.ok()) {
    const { code } = await (await bank.post('/api/auth/code', { data: { phone: PHONE } })).json();
    login = await bank.post('/api/auth/register', { data: { phone: PHONE, code, name: 'Покупатель Гпэев', birthDate: '1990-01-01', password: 'password123' } });
    expect(login.ok()).toBeTruthy();
    const home = await (await bank.get('/api/home')).json();
    expect((await admin.post(`/api/admin/accounts/${home.accounts[0].id}/adjust`, { data: { direction: 'credit', amount: '10000.00', title: 'Зарплата' } })).ok()).toBeTruthy();
  }
  return bank;
}

/** Approves whatever the bank app is asking the customer to confirm (a card purchase or a Bobo Pay request). */
async function approveInBank(bank: APIRequestContext) {
  await expect.poll(async () => {
    const pulse = await (await bank.get('/api/pulse')).json();
    return pulse.confirmations.length + pulse.requests.length;
  }, { timeout: 10_000 }).toBeGreaterThan(0);
  const pulse = await (await bank.get('/api/pulse')).json();
  const home = await (await bank.get('/api/home')).json();
  for (const c of pulse.confirmations) expect((await bank.post(`/api/confirmations/${c.id}`, { data: { approve: true } })).ok()).toBeTruthy();
  for (const r of pulse.requests) expect((await bank.post(`/api/requests/${r.id}`, { data: { approve: true, accountId: home.accounts[0].id } })).ok()).toBeTruthy();
}

test('merchant onboarding, API payment, checkout, receipt and refund', async ({ page, request, baseURL }) => {
  // Register and connect a shop.
  await page.goto('/register');
  await page.getByLabel('Как к вам обращаться').fill('E2E Продавец');
  await page.getByLabel('Рабочий email').fill(EMAIL);
  await page.getByLabel('Пароль').fill('password123');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app\/new$/);
  await page.getByLabel('Название магазина').fill('E2E Магазин');
  await page.getByLabel('Юридическое название').fill('ООО «Тест»');
  await page.getByRole('button', { name: 'Сгенерировать' }).click();
  await expect(page.getByLabel('ИНН')).toHaveValue(/^\d{10}$/);
  await page.getByRole('button', { name: 'Подключить магазин' }).click();
  await expect(page.getByText('Магазин готов принимать платежи')).toBeVisible();
  const shopId = page.url().split('/').pop();

  // Issue a secret key.
  await page.getByRole('link', { name: 'Разработчикам' }).click();
  await page.getByRole('button', { name: 'Выпустить ключ' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Выпустить' }).click();
  const secret = (await page.getByRole('dialog').locator('span.font-mono').first().textContent())!.trim();
  expect(secret).toMatch(/^sk_live_/);
  await page.getByRole('button', { name: 'Я сохранил ключ' }).click();

  // Create a payment through the public API.
  const auth = { Authorization: `Bearer ${secret}` };
  const created = await request.post('/api/v1/payments', {
    headers: { ...auth, 'Idempotence-Key': `e2e-${Date.now()}` },
    data: {
      amount: { value: '990.00', currency: 'RUB' },
      description: 'E2E заказ',
      confirmation: { type: 'redirect', return_url: `${baseURL}/` },
      receipt: { customer: { email: 'buyer@shop.test' }, items: [{ description: 'Товар', quantity: 1, amount: { value: '990.00', currency: 'RUB' }, vat_code: 'vat22' }] },
    },
  });
  expect(created.ok()).toBeTruthy();
  const payment = await created.json();
  expect(payment.status).toBe('pending');

  // Buyer: a card outside Bobobank is rejected in the browser.
  const bank = await bankCustomer();
  const home = await (await bank.get('/api/home')).json();
  const card = await (await bank.post(`/api/cards/${home.cards[0].id}/reveal`, { data: {} })).json();
  let cardCalls = 0;
  page.on('request', (r) => r.url().endsWith('/card') && cardCalls++);
  await page.goto(new URL(payment.confirmation.confirmation_url).pathname);
  await page.locator('#cc-number').fill('4242424242424242');
  await page.locator('#cc-exp').fill('1230');
  await page.locator('#cc-csc').fill('123');
  await page.getByRole('button', { name: /Оплатить/ }).click();
  await expect(page.getByText('Карта не поддерживается')).toBeVisible();
  expect(cardCalls).toBe(0);

  // The Bobobank card: the purchase is confirmed in the bank app.
  await page.locator('#cc-number').fill(card.pan);
  await page.locator('#cc-exp').fill(card.exp.replace('/', ''));
  await page.locator('#cc-csc').fill(card.cvc);
  await page.getByRole('button', { name: /Оплатить/ }).click();
  await expect(page.getByText('Подтвердите покупку в приложении Bobobank')).toBeVisible();
  await approveInBank(bank);
  await expect(page.getByText('Оплата прошла успешно')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'остаться' }).click();

  // Fiscal receipt.
  await page.getByRole('button', { name: 'Кассовый чек' }).click();
  await expect(page.getByText('КАССОВЫЙ ЧЕК')).toBeVisible();
  await expect(page.getByText('=990.00').first()).toBeVisible();

  // API sees the payment as succeeded; refund part of it from the cabinet.
  const got = await (await request.get(`/api/v1/payments/${payment.id}`, { headers: auth })).json();
  expect(got.status).toBe('succeeded');
  expect(got).toMatchObject({ test: false, payment_method: { card: { issuer_name: 'Bobobank' } } });
  await page.goto(`/app/${shopId}/payments/${payment.id}`);
  await page.getByRole('button', { name: 'Вернуть деньги' }).click();
  await page.getByRole('dialog').getByLabel('Сумма возврата').fill('190');
  await page.getByRole('dialog').getByRole('button', { name: /Вернуть/ }).click();
  await expect(page.getByText('Частичный возврат').first()).toBeVisible();
  const receipts = await (await request.get(`/api/v1/receipts?payment_id=${payment.id}`, { headers: auth })).json();
  expect(receipts.items.map((r: { type: string }) => r.type).sort()).toEqual(['payment', 'refund']);
});

test('payment link paid with Bobo Pay by phone', async ({ page, request }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Пароль').fill('password123');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.getByRole('link', { name: 'Ссылки и счета' }).click();
  await page.getByRole('button', { name: 'Новая ссылка' }).click();
  await page.getByLabel('Что продаёте').fill('Донат');
  await page.getByRole('tab', { name: 'Покупатель вводит сумму' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Создать ссылку' }).click();
  const url = (await page.getByRole('dialog').locator('span.font-mono').first().textContent())!.trim();
  await page.goto(new URL(url).pathname);
  await page.getByLabel('Сумма').fill('250');
  await page.getByRole('button', { name: 'Перейти к оплате' }).click();
  await page.getByRole('tab', { name: 'Bobo Pay' }).click();
  await expect(page.getByRole('link', { name: 'Bobo Pay' })).toHaveAttribute('href', /method=bobopay/);
  await page.getByLabel('Номер телефона в Bobobank').fill(`+${PHONE}`);
  await page.getByRole('button', { name: 'Отправить запрос в приложение' }).click();
  await expect(page.getByText('Подтвердите оплату в приложении Bobobank')).toBeVisible();
  await approveInBank(await bankCustomer());
  await expect(page.getByText('Оплата прошла успешно')).toBeVisible({ timeout: 15_000 });
  expect((await request.get('/api/health')).ok()).toBeTruthy();
});
