import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const LOGIN = process.env.ADMIN_LOGIN ?? 'admin';
const TEMP_PASSWORD = process.env.ADMIN_PASSWORD ?? '';
const NEW_PASSWORD = 'Zhuko-Net-Strong-Pass-2026';
const MASTER = 'чёрный жук летит над сетью 2026';
const SHOTS = process.env.SCREENSHOT_DIR;

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

/** Clicks a sidebar navigation link. */
function nav(page: Page, name: string) {
  return page.getByRole('navigation').getByRole('link', { name, exact: true }).click();
}

// A small valid PNG (64x48, blue) used as a client photo.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAfUlEQVRoge2SAQkAURSDlstQ18qeF2M8/sAAOhY+T5O6AQuwviK7kHdJ3YAFWF+RXci7pG7AAqyvyC7kXVI3YAHWV2QX8i6pG7AA6yuyC3mX1A1YgPUV2YW8S+oGLMD6iuxC3iV1AxZgfUV2Ie+SugELsL4iu5B3Sd2AxwN+TVac4lo3cPsAAAAASUVORK5CYII=',
  'base64',
);

test.describe.configure({ mode: 'serial' });

test('full portal flow', async ({ page }) => {
  test.skip(!TEMP_PASSWORD, 'ADMIN_PASSWORD not set');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });

  // --- Login & forced password change ---
  await page.goto('/');
  await shot(page, '01-login');
  await page.getByLabel('Логин').fill(LOGIN);
  await page.getByLabel('Пароль').fill('wrong-password');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByText('Неверный логин или пароль')).toBeVisible();
  await page.getByLabel('Пароль').fill(TEMP_PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByText('Задайте свой пароль вместо временного')).toBeVisible();
  await page.getByLabel('Текущий (временный) пароль').fill(TEMP_PASSWORD);
  await page.getByLabel('Новый пароль', { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel('Повторите новый пароль').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Сменить пароль' }).click();
  await expect(page.getByRole('heading', { name: /Добр/ })).toBeVisible();

  // --- Employees ---
  await nav(page, 'Сотрудники');
  await page.getByRole('button', { name: 'Добавить' }).click();
  await page.getByLabel('ФИО *').fill('Мария Соколова');
  await page.getByLabel('Логин для входа *').fill('m.sokolova');
  await page.getByLabel('Должность').fill('Pentester');
  await page.getByLabel('Отдел').fill('Red Team');
  await page.getByLabel('Telegram').fill('@msokolova');
  await page.getByRole('button', { name: 'Создать' }).click();
  await expect(page.getByText('Сотрудник добавлен')).toBeVisible();
  await page.getByRole('button', { name: 'Готово' }).click();
  await expect(page.getByText('Мария Соколова')).toBeVisible();
  await shot(page, '03-employees');

  // --- Clients ---
  await nav(page, 'Клиенты');
  await page.getByRole('button', { name: 'Новый клиент' }).click();
  await page.getByLabel('ФИО *').fill('Пётр Иванов');
  await page.getByLabel('Телефон').fill('+49 151 1234567');
  await page.getByRole('button', { name: 'Создать и открыть' }).click();
  await expect(page.getByRole('tab', { name: 'Обзор' })).toBeVisible();
  await page.getByLabel('Тариф').fill('Умный дом — премиум');
  await page.getByLabel('Адрес').fill('Berlin, Musterstraße 1');
  await page.getByRole('button', { name: 'Поле' }).click();
  await page.getByPlaceholder('Название').fill('Код домофона');
  await page.getByPlaceholder('Значение').fill('1234#');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Карточка сохранена')).toBeVisible();
  await shot(page, '04-client-card');

  await page.getByRole('tab', { name: 'Инфраструктура' }).click();
  await page.getByRole('button', { name: 'Строка' }).click();
  await page.getByPlaceholder('Имя').fill('Роутер Fritz!Box');
  await page.getByPlaceholder('192.168.0.1').fill('192.168.178.1');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Сохранено')).toBeVisible();

  await page.getByRole('tab', { name: 'Фото' }).click();
  await page.locator('input[type=file][accept="image/*"]').setInputFiles({ name: 'object.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('figure img')).toHaveCount(1);

  await page.getByRole('tab', { name: 'История' }).click();
  await page.getByPlaceholder(/Что произошло/).fill('Первичный выезд, установили датчики');
  await page.getByRole('button', { name: 'Добавить запись' }).click();
  await expect(page.getByText('Первичный выезд, установили датчики')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('cell', { name: /Пётр Иванов/ })).toBeVisible();
  await shot(page, '05-clients');

  // --- Vault ---
  await nav(page, 'Пароли');
  await page.getByLabel('Мастер-ключ', { exact: true }).fill(MASTER);
  await page.getByLabel('Повторите мастер-ключ').fill(MASTER);
  await page.getByRole('button', { name: 'Создать хранилище' }).click();
  await expect(page.getByText('Сохраните код восстановления')).toBeVisible({ timeout: 30_000 });
  await page.getByText('Я сохранил(а) код в надёжном месте').click();
  await page.getByRole('button', { name: 'Продолжить' }).click();

  await page.getByRole('button', { name: 'Импорт JSON' }).click();
  await page.locator('textarea').fill(
    JSON.stringify({
      servers: [
        { site: 'github.com', login: 'zhukonet-bot', password: 'Gh!7xP2q-Vb9z' },
        { url: 'https://router.local', username: 'admin', pass: 'admin' },
      ],
      bitwarden: { items: [{ name: 'Hetzner', login: { username: 'ops@zhukonet.de', password: 'Hz#55-qwe-RTY!', uris: [{ uri: 'https://console.hetzner.cloud' }] } }] },
    }),
  );
  await page.getByRole('button', { name: 'Разобрать' }).click();
  await expect(page.getByText('Найдено: 3')).toBeVisible();
  await page.getByRole('button', { name: /Импортировать \(3\)/ }).click();
  await expect(page.getByRole('cell', { name: /github\.com/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('cell', { name: /router\.local/ }).first()).toBeVisible();
  await expect(page.getByText(/слабых: \d/)).toBeVisible();
  await page.getByRole('row', { name: /github\.com/ }).getByRole('button', { name: 'Показать' }).first().click();
  await expect(page.getByText('Gh!7xP2q-Vb9z')).toBeVisible();

  // Discord token entry with category + extra field
  await page.getByRole('button', { name: 'Добавить' }).click();
  await page.getByLabel('Категория').selectOption('discord');
  await page.getByLabel('Название аккаунта / сервиса').fill('Discord · рабочий');
  await page.getByLabel('Логин / email / ID').fill('zhukonet#0001');
  await page.getByLabel('Токен / пароль').fill('discord-main-token-xyz');
  await page.getByRole('button', { name: 'Поле' }).click();
  await page.getByPlaceholder('Название (Токен…)').fill('Steam-ключ');
  await page.getByPlaceholder('Значение').fill('STEAM-KEY-7788');
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('cell', { name: /Discord · рабочий/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Discord · рабочий/ }).getByText('Discord', { exact: true })).toBeVisible();
  // filter by category
  const categoryFilter = page.getByRole('combobox').filter({ hasText: 'Все категории' });
  await categoryFilter.selectOption('discord');
  await expect(page.getByRole('cell', { name: /github\.com/ })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: /Discord · рабочий/ })).toBeVisible();
  await categoryFilter.selectOption('');
  await shot(page, '06-vault');

  // --- ZeroTier ---
  await nav(page, 'ZeroTier');
  await page.getByRole('button', { name: 'Добавить сеть' }).click();
  await page.getByLabel('Network ID *').fill('8056c2e21c000001');
  await page.getByLabel('Название *').fill('Офис ZhukoNet');
  await page.getByPlaceholder('10.147.17.0/24').fill('10.147.17.0/24');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Офис ZhukoNet').first()).toBeVisible();
  await page.getByRole('button', { name: 'Узел' }).click();
  await page.getByLabel('Node ID *').fill('a1b2c3d4e5');
  await page.getByLabel('Имя').fill('Ноутбук Алексея');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Ноутбук Алексея')).toBeVisible();
  await shot(page, '07-zerotier');

  // --- Devices ---
  await nav(page, 'Устройства');
  await page.getByRole('button', { name: 'Добавить' }).click();
  await page.getByLabel('Название *').fill('Датчик температуры #1');
  await page.getByLabel('MAC').fill('24:6f:28:aa:bb:cc');
  await page.getByLabel('Название прошивки').fill('sensor-node');
  await page.getByLabel('Версия').fill('1.4.2');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Датчик температуры #1')).toBeVisible();
  await shot(page, '08-devices');

  // --- Wi-Fi ---
  await nav(page, 'Wi-Fi');
  await page.getByRole('button', { name: 'Добавить сеть' }).click();
  await page.getByLabel('Название сети (SSID) *').fill('ZhukoNet-Office');
  await page.getByLabel('Пароль').fill('WifiPass-2026!');
  await page.getByLabel('Защита').selectOption('wpa3');
  await page.getByLabel(/Координаты/).fill('52.5200, 13.4050');
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('cell', { name: 'ZhukoNet-Office' })).toBeVisible();
  await page.getByRole('row', { name: /ZhukoNet-Office/ }).getByRole('button', { name: 'Показать' }).click();
  await expect(page.getByText('WifiPass-2026!')).toBeVisible();
  // map view renders a marker for the geocoded network
  await page.getByTitle('Карта').click();
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(1);
  // tile layer carries a referrer policy so OSM does not return 403
  await expect(page.locator('.leaflet-tile-pane img').first()).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  // hovering the marker shows a brief-info tooltip
  await page.locator('.leaflet-marker-icon').first().hover();
  await expect(page.locator('.zn-tip')).toContainText('ZhukoNet-Office');
  await expect(page.locator('.zn-tip')).toContainText('WPA3');
  await shot(page, '14-wifi');
  await page.getByTitle('Список').click();

  await nav(page, 'USB-консоль');
  await expect(page.getByRole('heading', { name: 'USB-консоль' })).toBeVisible();
  await shot(page, '09-console');

  // --- Dashboard, audit ---
  await nav(page, 'Дашборд');
  await page.getByPlaceholder('Быстро добавить задачу…').fill('Проверить датчики у Петра Иванова');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Проверить датчики у Петра Иванова').first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: /Добр/ })).toBeVisible();
  await shot(page, '02-dashboard');

  await nav(page, 'Журнал');
  const log = page.getByRole('main').getByRole('listitem');
  await expect(log.filter({ hasText: 'Просмотр пароля' }).first()).toBeVisible();
  await expect(log.filter({ hasText: 'Неудачный вход' }).first()).toBeVisible();
  await shot(page, '10-audit');

  // --- Mobile layout ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/clients');
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible();
  await expect(page.getByText('Пётр Иванов')).toBeVisible();
  await shot(page, '11-mobile-clients');
  await page.getByRole('button', { name: 'Меню' }).click();
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Сотрудники' })).toBeVisible();
  await shot(page, '12-mobile-menu');

  expect(errors).toEqual([]);
});

test('serial console with a mocked port', async ({ page }) => {
  test.skip(!TEMP_PASSWORD, 'ADMIN_PASSWORD not set');
  // Fake Web Serial: an "ESP32 via CP2102" that prints sensor lines and echoes what it receives.
  await page.addInitScript(() => {
    const enc = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const written: string[] = [];
    (window as unknown as { __serialWritten: string[] }).__serialWritten = written;
    const port = {
      readable: null as ReadableStream<Uint8Array> | null,
      writable: null as WritableStream<Uint8Array> | null,
      getInfo: () => ({ usbVendorId: 0x10c4, usbProductId: 0xea60 }),
      async open() {
        let n = 0;
        this.readable = new ReadableStream({
          start(c) {
            controller = c;
            const timer = setInterval(() => {
              n++;
              try {
                c.enqueue(enc.encode(`temp:${(20 + Math.sin(n / 3)).toFixed(2)} hum:${40 + (n % 5)}\r\n`));
              } catch {
                clearInterval(timer);
              }
            }, 50);
          },
        });
        this.writable = new WritableStream({
          write(chunk) {
            const text = new TextDecoder().decode(chunk);
            written.push(text);
            controller?.enqueue(enc.encode(`echo: ${text.trim()}\n`));
          },
        });
      },
      async close() {
        this.readable = null;
        this.writable = null;
      },
      async setSignals() {},
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(navigator, 'serial', {
      value: { requestPort: async () => port, getPorts: async () => [port], addEventListener() {}, removeEventListener() {} },
    });
  });

  await page.goto('/');
  await page.getByLabel('Логин').fill(LOGIN);
  await page.getByLabel('Пароль').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await nav(page, 'USB-консоль');
  await page.getByRole('button', { name: 'Подключить устройство' }).click();
  await expect(page.getByText(/Подключено: ESP32 \(мост CP210x\)/)).toBeVisible();
  await expect(page.getByText(/temp:\d+\.\d+ hum:\d+/).first()).toBeVisible();

  await page.getByPlaceholder(/Команда/).fill('status');
  await page.keyboard.press('Enter');
  await expect(page.getByText('echo: status')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __serialWritten: string[] }).__serialWritten)).toContain('status\n');

  await page.getByRole('button', { name: 'Плоттер' }).click();
  await expect(page.locator('.uplot')).toBeVisible();
  await expect(page.locator('.u-legend').getByText('temp')).toBeVisible();
  await shot(page, '13-console-connected');

  await page.getByRole('button', { name: 'Добавить в реестр' }).click();
  await expect(page.getByLabel('USB VID')).toHaveValue('10c4');
  await page.getByLabel('Название *').fill('ESP32 стенд');
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('«ESP32 стенд» добавлено в реестр')).toBeVisible();
  await page.getByRole('button', { name: 'Отключить' }).click();
  await expect(page.getByText(/Отключено$/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Переподключить' })).toBeVisible();
});
