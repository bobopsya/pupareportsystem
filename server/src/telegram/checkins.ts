import type { Ctx } from '../context.js';
import { getSetting, setSetting } from '../db.js';
import { getTgToken, TgApi, type Keyboard } from './api.js';

/** Moscow time has no DST: always UTC+3. */
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Private reminders to employees who have not checked in yet (Moscow time). */
export const REMINDER_SLOTS = ['20:00', '23:00'];

export const CHANNEL_KEY = 'tg_channel';
export const TEMPLATE_KEY = 'tg_template';
export const BOT_NAME_KEY = 'tg_bot_username';
export const START_DAY_KEY = 'checkin_start_day';
const LAST_REMINDER_KEY = 'tg_last_reminder';

export const DEFAULT_TEMPLATE = '⚠️ {имя} не отметился(-ась) за {дата}.';
export const PLACEHOLDERS = ['{имя}', '{логин}', '{должность}', '{дата}'];

export function mskDay(ts: number): string {
  return new Date(ts + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

export function mskTime(ts: number): string {
  return new Date(ts + MSK_OFFSET_MS).toISOString().slice(11, 16);
}

/** UTC timestamp of 00:00 MSK on the given day. */
export function dayStart(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) - MSK_OFFSET_MS;
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function fmtDay(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d}.${m}.${y}`;
}

export interface Person {
  id: string;
  login: string;
  fullName: string;
  position: string;
  status: string;
  createdAt: number;
}

export function listPeople(ctx: Ctx): Person[] {
  const rows = ctx.db.prepare('SELECT id, login, data, created_at FROM users WHERE deleted_at IS NULL ORDER BY created_at').all() as {
    id: string;
    login: string;
    data: string;
    created_at: number;
  }[];
  return rows.map((r) => {
    const d = JSON.parse(r.data);
    return { id: r.id, login: r.login, fullName: d.fullName ?? r.login, position: d.position ?? '', status: d.status ?? 'active', createdAt: r.created_at };
  });
}

/** Employees who must check in on `day`: active (not on vacation/fired) and existing before that day began. */
export function requiredPeople(ctx: Ctx, day: string): Person[] {
  const start = dayStart(day);
  return listPeople(ctx).filter((p) => p.status === 'active' && p.createdAt < start);
}

export function getCheckin(ctx: Ctx, userId: string, day: string) {
  return ctx.db.prepare('SELECT ts, source FROM checkins WHERE user_id = ? AND day = ?').get(userId, day) as { ts: number; source: string } | undefined;
}

/** Records today's check-in. Returns the existing one if the employee already checked in. */
export function checkIn(ctx: Ctx, userId: string, source: 'web' | 'telegram') {
  const now = ctx.now();
  const day = mskDay(now);
  const prev = getCheckin(ctx, userId, day);
  if (prev) return { day, ts: prev.ts, source: prev.source, already: true };
  ctx.db.prepare('INSERT INTO checkins(user_id, day, ts, source) VALUES(?,?,?,?)').run(userId, day, now, source);
  return { day, ts: now, source, already: false };
}

export function getTemplate(ctx: Ctx) {
  return getSetting(ctx.db, TEMPLATE_KEY) ?? DEFAULT_TEMPLATE;
}

export function renderTemplate(template: string, p: Pick<Person, 'fullName' | 'login' | 'position'>, day: string) {
  return template
    .replaceAll('{имя}', p.fullName)
    .replaceAll('{логин}', p.login)
    .replaceAll('{должность}', p.position || '—')
    .replaceAll('{дата}', fmtDay(day));
}

/** Accepts "@name", "https://t.me/name", "t.me/name" or a numeric chat id ("-100…"). */
export function normalizeChannel(input: string): string | null {
  const s = input.trim();
  if (/^-?\d{5,20}$/.test(s)) return s;
  const m = /^(?:https?:\/\/)?(?:t\.me\/|telegram\.me\/|@)?([a-zA-Z][a-zA-Z0-9_]{3,31})\/?$/.exec(s);
  return m ? `@${m[1]}` : null;
}

export const CHECKIN_BUTTON: Keyboard = [[{ text: '✅ Отметиться', callback_data: 'ci' }]];

export interface ScheduleStatus {
  lastError: string | null;
  lastErrorAt: number | null;
  lastReportAt: number | null;
}

export const scheduleStatus: ScheduleStatus = { lastError: null, lastErrorAt: null, lastReportAt: null };

function fail(ctx: Ctx, err: unknown) {
  scheduleStatus.lastError = (err as Error).message;
  scheduleStatus.lastErrorAt = ctx.now();
}

/**
 * Runs once a minute:
 * - after 00:00 MSK posts the shared message to the channel for every employee who did not check in yesterday
 *   (each employee at most once per day; failures are retried on the next run);
 * - at the reminder slots nudges linked employees who have not checked in today.
 */
export async function runSchedule(ctx: Ctx) {
  const token = getTgToken(ctx);
  if (!token) return { reported: 0, reminded: 0 };
  const api = new TgApi(ctx, token);
  const now = ctx.now();
  const today = mskDay(now);
  const yesterday = addDays(today, -1);
  let reported = 0;
  let reminded = 0;

  const channel = getSetting(ctx.db, CHANNEL_KEY);
  const startDay = getSetting(ctx.db, START_DAY_KEY);
  if (channel && startDay && yesterday >= startDay) {
    const template = getTemplate(ctx);
    for (const p of requiredPeople(ctx, yesterday)) {
      if (getCheckin(ctx, p.id, yesterday)) continue;
      if (ctx.db.prepare('SELECT 1 FROM checkin_reports WHERE day = ? AND user_id = ?').get(yesterday, p.id)) continue;
      try {
        await api.send(channel, renderTemplate(template, p, yesterday), undefined, false);
      } catch (err) {
        fail(ctx, err);
        break;
      }
      ctx.db.prepare('INSERT INTO checkin_reports(day, user_id, sent_at) VALUES(?,?,?)').run(yesterday, p.id, ctx.now());
      scheduleStatus.lastReportAt = ctx.now();
      reported++;
    }
  }

  const minutes = Number(mskTime(now).slice(0, 2)) * 60 + Number(mskTime(now).slice(3));
  const due = REMINDER_SLOTS.filter((s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3)) <= minutes).pop();
  const slotKey = due ? `${today} ${due}` : null;
  if (slotKey && (getSetting(ctx.db, LAST_REMINDER_KEY) ?? '') < slotKey) {
    // Mark first: a reminder is a nicety, sending it twice is worse than skipping one.
    setSetting(ctx.db, LAST_REMINDER_KEY, slotKey);
    const links = ctx.db.prepare('SELECT tg_id, user_id FROM tg_links').all() as { tg_id: number; user_id: string }[];
    const required = new Set(requiredPeople(ctx, today).map((p) => p.id));
    for (const l of links) {
      if (!required.has(l.user_id) || getCheckin(ctx, l.user_id, today)) continue;
      try {
        await api.send(l.tg_id, `⏰ Вы ещё не отметились сегодня. Отметка до 00:00 МСК.`, CHECKIN_BUTTON);
        reminded++;
      } catch (err) {
        fail(ctx, err);
      }
    }
  }
  return { reported, reminded };
}
