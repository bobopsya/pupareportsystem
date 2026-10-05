import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { audit, HttpError, type Ctx } from '../context.js';
import { sha256 } from '../crypto.js';
import { getSetting, setSetting } from '../db.js';
import { getTgToken, TgApi, TgError, TOKEN_KEY } from '../telegram/api.js';
import type { TelegramBot } from '../telegram/bot.js';
import {
  addDays,
  BOT_NAME_KEY,
  CHANNEL_KEY,
  checkIn,
  DEFAULT_TEMPLATE,
  fmtDay,
  getTemplate,
  listPeople,
  mskDay,
  normalizeChannel,
  PLACEHOLDERS,
  renderTemplate,
  REMINDER_SLOTS,
  requiredPeople,
  scheduleStatus,
  START_DAY_KEY,
  TEMPLATE_KEY,
} from '../telegram/checkins.js';

const LINK_CODE_TTL_MS = 15 * 60 * 1000;
const TEMPLATE_META_KEY = 'tg_template_meta';

function tgHttpError(err: unknown): HttpError {
  if (!(err instanceof TgError)) return err instanceof HttpError ? err : new HttpError(502, 'Telegram недоступен');
  if (err.code === 401 || err.code === 404) return new HttpError(400, 'Telegram отклонил токен бота');
  if (/chat not found/i.test(err.message)) return new HttpError(400, 'Канал не найден. Проверьте адрес и что бот добавлен в канал администратором');
  if (/not enough rights|not a member|kicked|have no rights/i.test(err.message)) return new HttpError(400, 'У бота нет прав писать в канал — добавьте его администратором с правом публикации');
  return new HttpError(502, `Telegram: ${err.message}`);
}

export function registerTelegramRoutes(app: FastifyInstance, ctx: Ctx, bot?: TelegramBot) {
  const { db } = ctx;

  // ---------- check-ins ----------

  app.get('/api/checkins', async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(62).default(14) }).parse(req.query ?? {});
    const today = mskDay(ctx.now());
    const from = addDays(today, -(days - 1));
    const rows = db.prepare('SELECT user_id, day, ts, source FROM checkins WHERE day >= ?').all(from) as { user_id: string; day: string; ts: number; source: string }[];
    const reported = db.prepare('SELECT user_id, day FROM checkin_reports WHERE day >= ?').all(from) as { user_id: string; day: string }[];
    const links = new Map(
      (db.prepare('SELECT user_id, username FROM tg_links').all() as { user_id: string; username: string | null }[]).map((l) => [l.user_id, l.username]),
    );
    const dayList = Array.from({ length: days }, (_, i) => addDays(today, -i));
    const requiredByDay = new Map(dayList.map((d) => [d, new Set(requiredPeople(ctx, d).map((p) => p.id))]));
    const people = listPeople(ctx).filter((p) => p.status !== 'fired');
    return {
      today,
      days: dayList,
      startDay: getSetting(db, START_DAY_KEY),
      deadline: '00:00 МСК',
      employees: people.map((p) => ({
        id: p.id,
        fullName: p.fullName,
        login: p.login,
        position: p.position,
        status: p.status,
        telegram: links.has(p.id) ? { username: links.get(p.id) ?? null } : null,
        checkins: Object.fromEntries(rows.filter((r) => r.user_id === p.id).map((r) => [r.day, { ts: r.ts, source: r.source }])),
        required: dayList.filter((d) => requiredByDay.get(d)!.has(p.id)),
        reported: reported.filter((r) => r.user_id === p.id).map((r) => r.day),
      })),
    };
  });

  app.post('/api/checkins', async (req) => {
    const r = checkIn(ctx, req.user!.id, 'web');
    if (!r.already) audit(ctx, req, 'checkin', 'employee', req.user!.id, `Отметка за ${fmtDay(r.day)}`);
    return r;
  });

  // ---------- bot settings ----------

  app.get('/api/telegram', async (req) => {
    const me = db.prepare('SELECT username, linked_at FROM tg_links WHERE user_id = ?').get(req.user!.id) as { username: string | null; linked_at: number } | undefined;
    const meta = getSetting(db, TEMPLATE_META_KEY);
    return {
      tokenSet: !!getSetting(db, TOKEN_KEY),
      botUsername: getSetting(db, BOT_NAME_KEY),
      channel: getSetting(db, CHANNEL_KEY) ?? '',
      template: getTemplate(ctx),
      defaultTemplate: DEFAULT_TEMPLATE,
      templateMeta: meta ? (JSON.parse(meta) as { by: string; at: number }) : null,
      placeholders: PLACEHOLDERS,
      reminders: REMINDER_SLOTS,
      startDay: getSetting(db, START_DAY_KEY),
      linkedCount: (db.prepare('SELECT COUNT(*) c FROM tg_links').get() as { c: number }).c,
      status: {
        polling: bot?.status.running ?? false,
        lastPollAt: bot?.status.lastPollAt ?? null,
        lastError: bot?.status.lastError ?? scheduleStatus.lastError,
        lastReportAt: scheduleStatus.lastReportAt,
      },
      me: me ? { linked: true, username: me.username, linkedAt: me.linked_at } : { linked: false },
    };
  });

  app.put('/api/telegram/token', async (req) => {
    const { token } = z.object({ token: z.string().trim().regex(/^\d{5,15}:[A-Za-z0-9_-]{30,60}$/, 'Неверный формат токена (пример: 123456789:AA…)') }).parse(req.body);
    let me: { username?: string };
    try {
      me = await new TgApi(ctx, token).call<{ username?: string }>('getMe');
    } catch (err) {
      throw tgHttpError(err);
    }
    setSetting(db, TOKEN_KEY, ctx.secretCrypto.encryptString(token));
    setSetting(db, BOT_NAME_KEY, me.username ?? null);
    // update_id offsets belong to a specific bot.
    setSetting(db, 'tg_offset', null);
    // Missed check-ins are reported starting from the day after the bot is first configured.
    if (!getSetting(db, START_DAY_KEY)) setSetting(db, START_DAY_KEY, addDays(mskDay(ctx.now()), 1));
    audit(ctx, req, 'settings', 'settings', null, `Токен Telegram-бота обновлён (@${me.username ?? '?'})`);
    return { ok: true, botUsername: me.username ?? null };
  });

  app.delete('/api/telegram/token', async (req) => {
    setSetting(db, TOKEN_KEY, null);
    setSetting(db, BOT_NAME_KEY, null);
    setSetting(db, 'tg_offset', null);
    audit(ctx, req, 'settings', 'settings', null, 'Токен Telegram-бота удалён');
    return { ok: true };
  });

  app.put('/api/telegram/channel', async (req) => {
    const { channel } = z.object({ channel: z.string().max(200) }).parse(req.body);
    const norm = channel.trim() ? normalizeChannel(channel) : null;
    if (channel.trim() && !norm) throw new HttpError(400, 'Укажите канал как @имя, ссылку https://t.me/имя или числовой id (-100…)');
    setSetting(db, CHANNEL_KEY, norm);
    audit(ctx, req, 'settings', 'settings', null, norm ? `Канал Telegram: ${norm}` : 'Канал Telegram удалён');
    return { ok: true, channel: norm ?? '' };
  });

  app.put('/api/telegram/template', async (req) => {
    const { template } = z.object({ template: z.string().trim().min(1, 'Текст не может быть пустым').max(3000) }).parse(req.body);
    setSetting(db, TEMPLATE_KEY, template);
    setSetting(db, TEMPLATE_META_KEY, JSON.stringify({ by: req.user!.fullName, at: ctx.now() }));
    audit(ctx, req, 'settings', 'settings', null, 'Изменён текст сообщения о пропущенной отметке');
    return { ok: true };
  });

  app.post('/api/telegram/test', async (req) => {
    const token = getTgToken(ctx);
    if (!token) throw new HttpError(400, 'Сначала укажите токен бота');
    const channel = getSetting(db, CHANNEL_KEY);
    if (!channel) throw new HttpError(400, 'Сначала укажите канал');
    const me = listPeople(ctx).find((p) => p.id === req.user!.id)!;
    const text = `🧪 Тестовое сообщение портала ZhukoNet. Так будет выглядеть пост, если сотрудник не отметится:\n\n${renderTemplate(getTemplate(ctx), me, mskDay(ctx.now()))}`;
    try {
      await new TgApi(ctx, token).send(channel, text, undefined, false);
    } catch (err) {
      throw tgHttpError(err);
    }
    return { ok: true };
  });

  // ---------- linking the current employee's Telegram ----------

  app.post('/api/telegram/link', async (req) => {
    const username = getSetting(db, BOT_NAME_KEY);
    if (!getSetting(db, TOKEN_KEY) || !username) throw new HttpError(400, 'Telegram-бот ещё не настроен (Настройки → Telegram-бот)');
    const code = crypto.randomBytes(18).toString('base64url');
    const expiresAt = ctx.now() + LINK_CODE_TTL_MS;
    db.prepare('DELETE FROM tg_link_codes WHERE user_id = ? OR expires_at < ?').run(req.user!.id, ctx.now());
    db.prepare('INSERT INTO tg_link_codes(code_hash, user_id, expires_at) VALUES(?,?,?)').run(sha256(code), req.user!.id, expiresAt);
    return { url: `https://t.me/${username}?start=${code}`, expiresAt };
  });

  app.delete('/api/telegram/link', async (req) => {
    const r = db.prepare('DELETE FROM tg_links WHERE user_id = ?').run(req.user!.id);
    if (r.changes) audit(ctx, req, 'tg_unlink', 'employee', req.user!.id, 'Telegram отвязан');
    return { ok: true };
  });
}
