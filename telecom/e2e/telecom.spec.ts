import { expect, test, type Browser, type Page } from '@playwright/test';

const TEL = process.env.TELECOM_URL ?? 'http://localhost:8085';
const BANK = process.env.BANK_URL ?? 'http://localhost:8082';
const H = { 'x-requested-with': 'bobobank' };
const stamp = String(Date.now()).slice(-8);

test.describe.configure({ mode: 'serial' });

async function available(page: Page) {
  const home = await (await page.request.get(`${BANK}/api/home`)).json();
  return home.accounts[0].available as number;
}

/** A Bobobank customer with 5 000 ₽ who signs in to Бобтелеком and takes a number on a tariff. */
async function subscriber(browser: Browser, phone: string, name: string, tariff: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BANK}/register`);
  await page.getByLabel('Номер телефона').fill(phone.slice(1));
  await page.getByRole('button', { name: 'Получить код' }).click();
  await page.getByText('Код для входа в Bobobank').click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByLabel('Имя и фамилия').fill(name);
  await page.getByLabel('Дата рождения').fill('1992-03-10');
  await page.getByLabel('Придумайте пароль').fill('password123');
  await page.getByRole('button', { name: 'Открыть счёт' }).click();
  await expect(page.getByText('Последние операции')).toBeVisible();
  const admin = await browser.newContext();
  const r = await admin.request.post(`${BANK}/api/auth/login`, { headers: H, data: { phone: process.env.BANK_ADMIN_PHONE, password: process.env.BANK_ADMIN_PASSWORD } });
  expect(r.ok(), 'BANK_ADMIN_PHONE / BANK_ADMIN_PASSWORD must point to a bank admin').toBeTruthy();
  const main = (await (await page.request.get(`${BANK}/api/home`)).json()).accounts[0];
  expect((await admin.request.post(`${BANK}/api/admin/accounts/${main.id}/adjust`, { headers: H, data: { direction: 'credit', amount: '5000.00', title: 'Зарплата' } })).ok()).toBeTruthy();
  await admin.close();

  await page.goto(TEL);
  await page.getByRole('button', { name: 'Войти через Bobobank' }).click();
  await expect(page.getByText('Бобтелеком', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Разрешить' }).click();
  await page.waitForURL(`${TEL}/connect`);
  await page.getByRole('button', { name: new RegExp(`^${tariff}`) }).click();
  await page.getByRole('button', { name: 'Выбрать номер' }).click();
  await page.getByRole('button', { name: /Бесплатно/ }).first().click();
  await page.getByRole('button', { name: /^Дальше/ }).click();
  const before = await available(page);
  await page.getByRole('button', { name: /Подключить · / }).click();
  await expect(page.getByText('Номер подключён!')).toBeVisible();
  const number = (await page.locator('p.num').first().innerText()).trim();
  await page.getByRole('button', { name: 'Начать пользоваться' }).click();
  await expect(page.getByTestId('my-number')).toHaveText(number);
  return { page, number, before };
}

test('два абонента: подключение со списанием, SMS и звонок', async ({ browser }) => {
  const a = await subscriber(browser, `79${stamp}1`, 'Анна Звонова', 'Мини');
  expect(a.before - (await available(a.page))).toBe(299_00);
  await expect(a.page.getByText('Тариф «Мини»', { exact: true })).toBeVisible();
  const b = await subscriber(browser, `79${stamp}2`, 'Борис Слушаев', 'Базовый');
  expect(b.before - (await available(b.page))).toBe(549_00);

  // A orders home internet: −20% with the mobile number, the router in rent, a visit of the master.
  await a.page.getByRole('link', { name: /Домашний интернет/ }).click();
  await a.page.getByRole('button', { name: /^Дом 100 / }).click();
  await a.page.getByRole('button', { name: 'Указать адрес' }).click();
  await a.page.getByPlaceholder(/Улица/).fill('Тверская улица');
  await a.page.getByPlaceholder('Дом').fill('1');
  await a.page.getByPlaceholder('Квартира').fill('5');
  await a.page.getByRole('button', { name: 'Проверить адрес' }).click();
  await expect(a.page.getByText(/Дом подключён/)).toBeVisible();
  await a.page.getByRole('button', { name: 'Дальше' }).click();
  await a.page.getByRole('button', { name: /^Аренда/ }).click();
  await a.page.getByRole('button', { name: 'Выбрать время мастера' }).click();
  await a.page.locator('button:has-text("11:00–13:00")').first().click();
  await a.page.getByRole('button', { name: 'Дальше' }).click();
  const homeBefore = await available(a.page);
  await a.page.getByRole('button', { name: /Оплатить и вызвать мастера · 498/ }).click();
  await expect(a.page.getByText('Заявка принята', { exact: true })).toBeVisible();
  expect(homeBefore - (await available(a.page))).toBe(399_00 + 99_00);
  await a.page.getByRole('link', { name: 'Главная' }).click();
  await expect(a.page.getByText(/Мастер приедет/)).toBeVisible();

  // In the bank: the charge from Бобтелеком.
  expect(JSON.stringify(await (await a.page.request.get(`${BANK}/api/history`)).json())).toContain('Бобтелеком');

  // A writes to B.
  await a.page.getByRole('link', { name: 'Чаты' }).click();
  await a.page.getByRole('button', { name: 'Новое сообщение' }).click();
  await a.page.getByPlaceholder('+123 XXX XXX-XX-XX').fill(b.number);
  await a.page.getByRole('button', { name: 'Написать' }).click();
  await a.page.getByLabel('Сообщение').fill('Привет, это Анна!');
  await a.page.getByRole('button', { name: 'Отправить' }).click();
  await expect(a.page.getByText('Привет, это Анна!')).toBeVisible();
  await b.page.getByRole('link', { name: /Чаты/ }).click();
  await b.page.getByRole('link', { name: /Анна З\./ }).click();
  await expect(b.page.getByText('Привет, это Анна!')).toBeVisible();

  // A calls B from the chat; B answers, talks a bit and hangs up.
  await a.page.getByRole('button', { name: 'Позвонить' }).click();
  await expect(a.page.getByText('Вызов…')).toBeVisible();
  await expect(b.page.getByText('Входящий звонок')).toBeVisible({ timeout: 10_000 });
  await expect(b.page.getByRole('dialog', { name: 'Звонок' }).getByText('Анна З.')).toBeVisible();
  await b.page.getByRole('button', { name: 'Ответить' }).click();
  await expect(a.page.getByText(/^0:0\d$/)).toBeVisible({ timeout: 10_000 });
  await b.page.waitForTimeout(3000);
  await b.page.getByRole('button', { name: 'Завершить' }).click();
  await expect(a.page.getByText('Звонок завершён')).toBeVisible({ timeout: 10_000 });
  await expect(a.page.getByText('Списано 1 мин из пакета')).toBeVisible();
  await a.page.waitForTimeout(4500);
  await a.page.getByRole('link', { name: 'Главная' }).click();
  await expect(a.page.getByText('199', { exact: true })).toBeVisible();
  await a.page.getByRole('link', { name: 'Расходы' }).click();
  await expect(a.page.getByText('Тариф «Мини», первый месяц')).toBeVisible();

  // Bobobank knows B's number: a transfer to +123 … reaches B's account; B's profile shows the link.
  await expect(async () => {
    await b.page.goto(`${TEL}/profile`);
    await expect(b.page.getByText(`Переводы по номеру ${b.number} приходят на счёт`)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  const from = (await (await a.page.request.get(`${BANK}/api/home`)).json()).accounts[0].id;
  const bBefore = await available(b.page);
  const t = await a.page.request.post(`${BANK}/api/transfers`, { headers: H, data: { fromAccountId: from, recipient: { type: 'phone', phone: b.number }, amount: '150.00' } });
  expect(t.ok(), await t.text()).toBeTruthy();
  expect((await available(b.page)) - bBefore).toBe(150_00);
  await b.page.goto(`${BANK}/app/profile`);
  await expect(b.page.getByText(`Бобтелеком: ${b.number}`)).toBeVisible();
});
