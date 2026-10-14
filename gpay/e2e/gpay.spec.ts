import { expect, test } from '@playwright/test';

const EMAIL = `e2e-${Date.now()}@shop.test`;

test.describe.configure({ mode: 'serial' });

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

  // Buyer: a card outside the issuer's list is rejected in the browser.
  let cardCalls = 0;
  page.on('request', (r) => r.url().endsWith('/card') && cardCalls++);
  await page.goto(new URL(payment.confirmation.confirmation_url).pathname);
  await page.locator('#cc-number').fill('4242424242424242');
  await page.locator('#cc-exp').fill('1230');
  await page.locator('#cc-csc').fill('123');
  await page.getByRole('button', { name: /Оплатить/ }).click();
  await expect(page.getByText('Карта не поддерживается')).toBeVisible();
  expect(cardCalls).toBe(0);

  // 3-D Secure card: the bank confirms on its own within 3–5 seconds.
  await page.locator('#cc-number').fill('4000000000003220');
  await page.getByRole('button', { name: /Оплатить/ }).click();
  await expect(page.getByText('Связываемся с банком')).toBeVisible();
  await expect(page.getByText('Оплата прошла успешно')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'остаться' }).click();

  // Fiscal receipt.
  await page.getByRole('button', { name: 'Кассовый чек' }).click();
  await expect(page.getByText('КАССОВЫЙ ЧЕК')).toBeVisible();
  await expect(page.getByText('=990.00').first()).toBeVisible();

  // API sees the payment as succeeded; refund part of it from the cabinet.
  const got = await (await request.get(`/api/v1/payments/${payment.id}`, { headers: auth })).json();
  expect(got.status).toBe('succeeded');
  expect(got.authorization_details.three_d_secure.applied).toBe(true);
  await page.goto(`/app/${shopId}/payments/${payment.id}`);
  await page.getByRole('button', { name: 'Вернуть деньги' }).click();
  await page.getByRole('dialog').getByLabel('Сумма возврата').fill('190');
  await page.getByRole('dialog').getByRole('button', { name: /Вернуть/ }).click();
  await expect(page.getByText('Частичный возврат').first()).toBeVisible();
  const receipts = await (await request.get(`/api/v1/receipts?payment_id=${payment.id}`, { headers: auth })).json();
  expect(receipts.items.map((r: { type: string }) => r.type).sort()).toEqual(['payment', 'refund']);
});

test('payment link with SBP', async ({ page, request }) => {
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
  await page.getByRole('tab', { name: 'СБП' }).click();
  await page.getByRole('button', { name: 'Оплатить через СБП' }).click();
  await expect(page.getByText('Отсканируйте QR-код')).toBeVisible();
  await expect(page.getByText('Оплата прошла успешно')).toBeVisible({ timeout: 30_000 });
  expect((await request.get('/api/health')).ok()).toBeTruthy();
});
