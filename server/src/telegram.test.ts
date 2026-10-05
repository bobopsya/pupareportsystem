import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createCtx, type Ctx } from './context.js';
import { openDb } from './db.js';
import { createUser } from './routes/employees.js';
import { TelegramBot } from './telegram/bot.js';
import { checkIn, dayStart, mskDay, normalizeChannel, renderTemplate, runSchedule, scheduleStatus } from './telegram/checkins.js';

const H = { 'x-requested-with': 'zhukonet' };
const TOKEN = '123456789:TEST_fake_token_not_real_0123456789ab';

let dir: string;
let ctx: Ctx;
let app: FastifyInstance;
let clock: number;
let calls: { method: string; params: Record<string, unknown> }[];
let failSend: string | null;
let photo: Buffer;

/** Minimal fake of the Bot API: records every call, answers what the code needs. */
function fakeTelegram(url: string, init: RequestInit): Promise<Response> {
  const json = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { headers: { 'content-type': 'application/json' } });
  if (url.includes('/file/bot')) return Promise.resolve(new Response(photo));
  const method = url.split('/').pop()!;
  const params = init.body ? JSON.parse(String(init.body)) : {};
  calls.push({ method, params });
  if (method === 'getMe') return Promise.resolve(json({ id: 1, username: 'zhukonet_bot' }));
  if (method === 'getFile') return Promise.resolve(json({ file_path: 'photos/p.jpg' }));
  if (method === 'sendMessage' && failSend) {
    return Promise.resolve(new Response(JSON.stringify({ ok: false, error_code: 400, description: failSend }), { status: 400 }));
  }
  return Promise.resolve(json(method === 'sendMessage' ? { message_id: calls.length, chat: { id: params.chat_id, type: 'private' } } : true));
}

const sent = () => calls.filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText');
const lastText = () => String(sent().at(-1)?.params.text ?? '');
const buttons = () => (sent().at(-1)?.params.reply_markup as { inline_keyboard: { text: string; callback_data?: string }[][] } | undefined)?.inline_keyboard.flat() ?? [];

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zn-tg-'));
  const cfg = loadConfig({ DATA_DIR: dir, DB_KEY: 'a'.repeat(64), FILES_KEY: 'b'.repeat(64), COOKIE_SECURE: '0', TG_API_URL: 'https://tg.test' });
  // 2026-03-10 12:00 MSK
  clock = Date.UTC(2026, 2, 10, 9, 0);
  ctx = createCtx(openDb(cfg.dataDir, cfg.dbKey), cfg, () => clock);
  ctx.http = fakeTelegram;
  calls = [];
  failSend = null;
  photo = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#888' } }).png().toBuffer();
  app = await buildApp(ctx);
});

afterEach(async () => {
  await app.close();
  ctx.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function session(login: string, fullName: string) {
  const u = await createUser(ctx, login, { fullName, position: 'Инженер' }, null);
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { login, password: u.tempPassword } });
  const cookie = `zn_sid=${res.cookies.find((c) => c.name === 'zn_sid')!.value}`;
  await app.inject({ method: 'POST', url: '/api/auth/change-password', headers: { ...H, cookie }, payload: { currentPassword: u.tempPassword, newPassword: 'Correct-Horse-42' } });
  return { id: u.id, h: { ...H, cookie } };
}

let updateId = 1;
const msg = (from: number, text: string, extra: Record<string, unknown> = {}) => ({
  update_id: updateId++,
  message: { message_id: updateId, chat: { id: from, type: 'private' }, from: { id: from, username: `u${from}` }, text, ...extra },
});
const press = (from: number, data: string) => ({
  update_id: updateId++,
  callback_query: { id: String(updateId), from: { id: from }, data, message: { message_id: 77, chat: { id: from, type: 'private' } } },
});

async function configureBot(h: Record<string, string>) {
  expect((await app.inject({ method: 'PUT', url: '/api/telegram/token', headers: h, payload: { token: TOKEN } })).statusCode).toBe(200);
  const ch = await app.inject({ method: 'PUT', url: '/api/telegram/channel', headers: h, payload: { channel: 'https://t.me/botaaaaaaaaaaaaaa' } });
  expect(ch.json().channel).toBe('@botaaaaaaaaaaaaaa');
}

async function linkTelegram(bot: TelegramBot, h: Record<string, string>, tgId: number) {
  const link = await app.inject({ method: 'POST', url: '/api/telegram/link', headers: h });
  const url = link.json().url as string;
  expect(url).toMatch(/^https:\/\/t\.me\/zhukonet_bot\?start=/);
  await bot.handleUpdate(msg(tgId, `/start ${url.split('start=')[1]}`));
}

describe('check-in helpers', () => {
  it('uses Moscow calendar days', () => {
    expect(mskDay(Date.UTC(2026, 2, 10, 20, 59))).toBe('2026-03-10');
    expect(mskDay(Date.UTC(2026, 2, 10, 21, 0))).toBe('2026-03-11');
    expect(dayStart('2026-03-11')).toBe(Date.UTC(2026, 2, 10, 21, 0));
  });

  it('normalizes channel addresses and renders the template', () => {
    expect(normalizeChannel('@my_channel')).toBe('@my_channel');
    expect(normalizeChannel('t.me/my_channel/')).toBe('@my_channel');
    expect(normalizeChannel('-1001234567890')).toBe('-1001234567890');
    expect(normalizeChannel('not a channel!')).toBeNull();
    expect(renderTemplate('{имя} ({логин}, {должность}) — {дата}', { fullName: 'Иван', login: 'ivan', position: '' }, '2026-03-09')).toBe('Иван (ivan, —) — 09.03.2026');
  });
});

describe('telegram bot', () => {
  it('validates the token via getMe and never returns it', async () => {
    const { h } = await session('admin', 'Админ');
    const bad = await app.inject({ method: 'PUT', url: '/api/telegram/token', headers: h, payload: { token: 'nope' } });
    expect(bad.statusCode).toBe(400);
    await configureBot(h);
    const info = await app.inject({ method: 'GET', url: '/api/telegram', headers: h });
    expect(info.json()).toMatchObject({ tokenSet: true, botUsername: 'zhukonet_bot', channel: '@botaaaaaaaaaaaaaa', startDay: '2026-03-11' });
    expect(info.body).not.toContain(TOKEN.split(':')[1]);
  });

  it('links an account with a one-time code and ignores strangers', async () => {
    const { h } = await session('admin', 'Админ Тестов');
    await configureBot(h);
    const bot = new TelegramBot(ctx);

    await bot.handleUpdate(msg(555, '/menu'));
    expect(lastText()).toContain('привяжите аккаунт');
    await bot.handleUpdate(msg(555, 'Петров'));
    expect(lastText()).toContain('привяжите аккаунт');

    const link = await app.inject({ method: 'POST', url: '/api/telegram/link', headers: h });
    const code = (link.json().url as string).split('start=')[1]!;
    await bot.handleUpdate(msg(555, `/start ${code}`));
    expect(sent().some((c) => String(c.params.text).includes('Telegram привязан'))).toBe(true);
    expect(bot.linkedUser(555)?.login).toBe('admin');

    // The code is single-use.
    await bot.handleUpdate(msg(666, `/start ${code}`));
    expect(lastText()).toContain('недействительна');
    expect(bot.linkedUser(666)).toBeNull();

    const me = await app.inject({ method: 'GET', url: '/api/telegram', headers: h });
    expect(me.json().me).toMatchObject({ linked: true, username: 'u555' });
    await app.inject({ method: 'DELETE', url: '/api/telegram/link', headers: h });
    expect(bot.linkedUser(555)).toBeNull();
  });

  it('checks in from the bot and from the site, once per day', async () => {
    const { h, id } = await session('admin', 'Админ');
    await configureBot(h);
    const bot = new TelegramBot(ctx);
    await linkTelegram(bot, h, 555);

    await bot.handleUpdate(press(555, 'ci'));
    expect(calls.some((c) => c.method === 'answerCallbackQuery')).toBe(true);
    expect(lastText()).toContain('Отмечено: 10.03.2026, 12:00 МСК');
    clock += 60_000;
    const web = await app.inject({ method: 'POST', url: '/api/checkins', headers: h });
    expect(web.json()).toMatchObject({ already: true, source: 'telegram' });

    const list = await app.inject({ method: 'GET', url: '/api/checkins?days=7', headers: h });
    const me = list.json().employees.find((e: { id: string }) => e.id === id);
    expect(me.checkins['2026-03-10'].source).toBe('telegram');
    expect(me.telegram).toEqual({ username: 'u555' });
  });

  it('posts the shared message to the channel after midnight for everyone who missed, once', async () => {
    const { h } = await session('admin', 'Админ Тестов');
    const ivan = await session('ivan', 'Иван Иванов');
    await session('olga', 'Ольга');
    const vac = await createUser(ctx, 'vasya', { fullName: 'Вася', status: 'vacation' }, null);
    expect(vac.id).toBeTruthy();
    await configureBot(h);
    await app.inject({ method: 'PUT', url: '/api/telegram/template', headers: h, payload: { template: 'Внимание: {имя} ({должность}) пропустил {дата}' } });

    // Day 1 (start day is the day after setup): only Ivan checks in.
    clock = Date.UTC(2026, 2, 11, 7, 0);
    checkIn(ctx, ivan.id, 'web');
    calls = [];
    expect((await runSchedule(ctx)).reported).toBe(0); // the day is not over yet

    // 00:01 MSK the next day.
    clock = Date.UTC(2026, 2, 11, 21, 1);
    expect((await runSchedule(ctx)).reported).toBe(2);
    const posts = calls.filter((c) => c.method === 'sendMessage' && c.params.chat_id === '@botaaaaaaaaaaaaaa').map((c) => c.params.text);
    expect(posts).toEqual(['Внимание: Админ Тестов (Инженер) пропустил 11.03.2026', 'Внимание: Ольга (Инженер) пропустил 11.03.2026']);

    // Not repeated on the next run.
    expect((await runSchedule(ctx)).reported).toBe(0);
  });

  it('retries the channel post if Telegram fails', async () => {
    const { h } = await session('admin', 'Админ');
    await configureBot(h);
    clock = Date.UTC(2026, 2, 12, 21, 5);
    failSend = 'Bad Request: chat not found';
    expect((await runSchedule(ctx)).reported).toBe(0);
    expect(scheduleStatus.lastError).toContain('chat not found');
    failSend = null;
    expect((await runSchedule(ctx)).reported).toBe(1);
  });

  it('reminds linked employees who have not checked in', async () => {
    const { h } = await session('admin', 'Админ');
    await configureBot(h);
    const bot = new TelegramBot(ctx);
    await linkTelegram(bot, h, 555);
    clock = Date.UTC(2026, 2, 12, 17, 5); // 20:05 MSK, admin existed before this day
    calls = [];
    expect((await runSchedule(ctx)).reminded).toBe(1);
    expect(lastText()).toContain('ещё не отметились');
    expect((await runSchedule(ctx)).reminded).toBe(0);
    await bot.handleUpdate(press(555, 'ci'));
    clock = Date.UTC(2026, 2, 12, 20, 5); // 23:05 — already checked in
    expect((await runSchedule(ctx)).reminded).toBe(0);
  });

  it('finds, edits clients and manages their history from the bot', async () => {
    const { h } = await session('admin', 'Админ');
    await configureBot(h);
    const bot = new TelegramBot(ctx);
    await linkTelegram(bot, h, 555);
    const c = (await app.inject({ method: 'POST', url: '/api/clients', headers: h, payload: { fullName: 'Пётр Петров', phones: ['+7 (912) 555-44-33'] } })).json();

    // Search by part of the name (case-insensitive Cyrillic) and by phone digits.
    await bot.handleUpdate(msg(555, 'пётр'));
    expect(buttons().map((b) => b.callback_data)).toContain(`c:${c.id}`);
    await bot.handleUpdate(msg(555, '5554433'));
    expect(buttons().map((b) => b.callback_data)).toContain(`c:${c.id}`);

    await bot.handleUpdate(press(555, `c:${c.id}`));
    expect(lastText()).toContain('Пётр Петров');

    // Edit address.
    await bot.handleUpdate(press(555, `cf:${c.id}:ad`));
    await bot.handleUpdate(msg(555, 'Москва, Тверская 1'));
    // Edit phones as a list, status, coordinates.
    await bot.handleUpdate(press(555, `cf:${c.id}:ph`));
    await bot.handleUpdate(msg(555, '+7 900, +7 901'));
    await bot.handleUpdate(press(555, `cs:${c.id}:active`));
    await bot.handleUpdate(press(555, `cf:${c.id}:loc`));
    await bot.handleUpdate(msg(555, '', { location: { latitude: 55.7558, longitude: 37.6173 } }));

    let client = (await app.inject({ method: 'GET', url: `/api/clients/${c.id}`, headers: h })).json();
    expect(client).toMatchObject({ address: 'Москва, Тверская 1', phones: ['+7 900', '+7 901'], status: 'active', lat: 55.7558, lng: 37.6173 });

    // Add a history entry, edit it, delete it.
    await bot.handleUpdate(press(555, `hk:${c.id}:call`));
    await bot.handleUpdate(msg(555, 'Позвонил, договорились о выезде'));
    let events = (await app.inject({ method: 'GET', url: `/api/client-events?clientId=${c.id}`, headers: h })).json();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'call', date: '2026-03-10', text: 'Позвонил, договорились о выезде' });
    await bot.handleUpdate(press(555, `ee:${events[0].id}`));
    await bot.handleUpdate(msg(555, 'Выезд перенесли'));
    events = (await app.inject({ method: 'GET', url: `/api/client-events?clientId=${c.id}`, headers: h })).json();
    expect(events[0].text).toBe('Выезд перенесли');
    await bot.handleUpdate(press(555, `edy:${events[0].id}`));
    events = (await app.inject({ method: 'GET', url: `/api/client-events?clientId=${c.id}`, headers: h })).json();
    expect(events).toHaveLength(0);

    // New client.
    await bot.handleUpdate(press(555, 'nc'));
    await bot.handleUpdate(msg(555, 'Новая Клиентка'));
    const all = (await app.inject({ method: 'GET', url: '/api/clients', headers: h })).json();
    expect(all.map((x: { fullName: string }) => x.fullName)).toContain('Новая Клиентка');

    // Photo upload.
    await bot.handleUpdate(press(555, `cp:${c.id}`));
    await bot.handleUpdate(msg(555, '', { photo: [{ file_id: 'abc', width: 40, height: 30 }], caption: 'Роутер' }));
    const files = (await app.inject({ method: 'GET', url: `/api/files?ownerType=client&ownerId=${c.id}`, headers: h })).json();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ kind: 'photo', caption: 'Роутер', hasThumb: true });

    // Everything is in the audit log, attributed to the employee.
    const audit = ctx.db.prepare("SELECT user_login, summary FROM audit WHERE summary LIKE '%(Telegram)'").all() as { user_login: string }[];
    expect(audit.length).toBeGreaterThan(5);
    expect(new Set(audit.map((a) => a.user_login))).toEqual(new Set(['admin']));

    client = (await app.inject({ method: 'GET', url: `/api/clients/${c.id}`, headers: h })).json();
    expect(client.fullName).toBe('Пётр Петров');
  });

  it('stops serving fired employees', async () => {
    const { h } = await session('admin', 'Админ');
    const ivan = await session('ivan', 'Иван');
    await configureBot(h);
    const bot = new TelegramBot(ctx);
    await linkTelegram(bot, ivan.h, 777);
    expect(bot.linkedUser(777)).not.toBeNull();
    await app.inject({ method: 'PUT', url: `/api/employees/${ivan.id}`, headers: h, payload: { fullName: 'Иван', status: 'fired' } });
    expect(bot.linkedUser(777)).toBeNull();
    await bot.handleUpdate(press(777, 'ci'));
    expect(ctx.db.prepare('SELECT COUNT(*) c FROM checkins').get()).toEqual({ c: 0 });
  });

  it('lists and completes my tasks', async () => {
    const { h, id } = await session('admin', 'Админ');
    await configureBot(h);
    const bot = new TelegramBot(ctx);
    await linkTelegram(bot, h, 555);
    const t = (await app.inject({ method: 'POST', url: '/api/tasks', headers: h, payload: { text: 'Заменить роутер', assigneeId: id } })).json();
    await bot.handleUpdate(msg(555, '/tasks'));
    expect(lastText()).toContain('Заменить роутер');
    await bot.handleUpdate(press(555, `td:${t.id}`));
    const task = (await app.inject({ method: 'GET', url: `/api/tasks/${t.id}`, headers: h })).json();
    expect(task.done).toBe(true);
  });
});
