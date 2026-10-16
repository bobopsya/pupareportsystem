import { HttpError, type Ctx, type SessionUser } from '../context.js';
import { newId, randomDigits } from '../util.js';
import { BankDown, chargeNow, refund, type BankCharge } from './bank.js';
import { assertFree, formatNumber, normalize, numberPrice, SYSTEM_SENDER } from './numbers.js';
import { addonOf, quotas, tariffOf, type Tariff } from './plans.js';

const DAY = 86_400_000;
/** After a failed monthly charge: try again in an hour (the bank was reachable but said no). */
const RETRY_DEBT_MS = 3600_000;
const RETRY_DOWN_MS = 60_000;
/** Simulated mobile data: a few megabytes every quarter of an hour. */
const DATA_EVERY_MS = 15 * 60_000;

export type LineStatus = 'connecting' | 'active' | 'blocked' | 'closed';

export interface LineRow {
  id: string;
  user_id: string;
  number: string;
  tariff: string;
  next_tariff: string | null;
  status: LineStatus;
  block_reason: 'debt' | 'admin' | 'no_mandate' | null;
  period_no: number;
  period_start: number;
  period_end: number;
  minutes_left: number;
  mb_left: number;
  sms_left: number;
  minutes_used: number;
  mb_used: number;
  sms_used: number;
  roaming_until: number | null;
  esim: string;
  retry_at: number | null;
  data_at: number;
  low_data_sent: number;
  created_at: number;
  closed_at: number | null;
}

export interface ChargeRow {
  id: string;
  user_id: string;
  line_id: string | null;
  home_id: string | null;
  kind: 'number' | 'subscription' | 'change' | 'addon' | 'home' | 'router';
  title: string;
  amount: number;
  external_id: string;
  bank_id: string | null;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  error: string | null;
  refunded: number;
  created_at: number;
  paid_at: number | null;
}

export const periodMs = (ctx: Ctx) => ctx.cfg.periodDays * DAY;

export const openLine = (ctx: Ctx, userId: string) => ctx.db.prepare(`SELECT * FROM lines WHERE user_id = ? AND status IN ('active', 'blocked') ORDER BY created_at DESC LIMIT 1`).get(userId) as LineRow | undefined;
export const lineByNumber = (ctx: Ctx, n: string) => ctx.db.prepare(`SELECT * FROM lines WHERE number = ? AND status IN ('active', 'blocked')`).get(n) as LineRow | undefined;
const lineById = (ctx: Ctx, id: string) => ctx.db.prepare('SELECT * FROM lines WHERE id = ?').get(id) as LineRow;

export function requireLine(ctx: Ctx, userId: string): LineRow {
  const l = openLine(ctx, userId);
  if (!l) throw new HttpError(404, 'Сначала подключите номер', 'no_line');
  return l;
}

/** A service message from Бобтелеком into the subscriber's chats. */
export function notifyLine(ctx: Ctx, number: string, text: string) {
  ctx.db.prepare('INSERT INTO messages(id, from_number, to_number, text, created_at) VALUES(?,?,?,?,?)').run(newId('msg', 16), SYSTEM_SENDER, number, text, ctx.now());
}

/** «2026-10-17» in Moscow time. */
export const mskDay = (ts: number) => new Date(ts + 3 * 3600_000).toISOString().slice(0, 10);

/** Mobile data of the last seven days, oldest first (empty days included). */
export function usage7(ctx: Ctx, lineId: string) {
  const rows = new Map((ctx.db.prepare('SELECT day, mb FROM data_usage WHERE line_id = ?').all(lineId) as { day: string; mb: number }[]).map((r) => [r.day, r.mb]));
  return Array.from({ length: 7 }, (_, i) => {
    const day = mskDay(ctx.now() - (6 - i) * DAY);
    return { day, mb: rows.get(day) ?? 0 };
  });
}

const rub = (r: number) => `${r.toLocaleString('ru-RU')} ₽`;
const date = (ts: number) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long' }).format(ts);

/**
 * Takes money through Bobobank and records it. The external id makes the charge happen at most once in the bank,
 * so a retry after a failure or a lost answer is safe.
 */
function pay(ctx: Ctx, user: { id: string; mandateId: string | null }, line: LineRow, kind: ChargeRow['kind'], title: string, rubles: number, externalId: string): Promise<ChargeRow> {
  return payFor(ctx, user, { lineId: line.id, homeId: null, subtitle: formatNumber(line.number) }, kind, title, rubles, externalId);
}

/** A charge for a mobile line or a home internet contract (the subtitle goes to the bank statement). */
export async function payFor(
  ctx: Ctx,
  user: { id: string; mandateId: string | null },
  target: { lineId: string | null; homeId: string | null; subtitle: string },
  kind: ChargeRow['kind'],
  title: string,
  rubles: number,
  externalId: string,
): Promise<ChargeRow> {
  const prev = ctx.db.prepare('SELECT * FROM charges WHERE external_id = ?').get(externalId) as ChargeRow | undefined;
  if (prev?.status === 'paid') return prev;
  const id = prev?.id ?? newId('chg', 16);
  if (!prev) {
    ctx.db
      .prepare(`INSERT INTO charges(id, user_id, line_id, home_id, kind, title, amount, external_id, status, created_at) VALUES(?,?,?,?,?,?,?,?,'pending',?)`)
      .run(id, user.id, target.lineId, target.homeId, kind, title, rubles * 100, externalId, ctx.now());
  } else {
    ctx.db.prepare(`UPDATE charges SET status = 'pending', error = NULL, amount = ?, title = ? WHERE id = ?`).run(rubles * 100, title, id);
  }
  if (!user.mandateId) {
    ctx.db.prepare(`UPDATE charges SET status = 'failed', error = ? WHERE id = ?`).run('Счёт Bobobank не привязан', id);
    throw new HttpError(403, 'Привяжите счёт Bobobank', 'no_mandate');
  }
  let c: BankCharge;
  try {
    c = await chargeNow(ctx, user.mandateId, rubles * 100, externalId, `Бобтелеком: ${title}`, target.subtitle);
  } catch (e) {
    const err = e instanceof HttpError ? e : new BankDown();
    if (err.code === 'mandate_revoked') ctx.db.prepare('UPDATE users SET mandate_id = NULL WHERE id = ?').run(user.id);
    ctx.db.prepare(`UPDATE charges SET status = 'failed', error = ? WHERE id = ?`).run(err.message, id);
    if (err.code === 'insufficient_funds') throw new HttpError(402, `На счёте Bobobank не хватает ${rub(rubles)}. Пополните счёт и попробуйте снова.`, 'insufficient_funds');
    throw err;
  }
  ctx.db.prepare(`UPDATE charges SET status = 'paid', bank_id = ?, paid_at = ? WHERE id = ?`).run(c.id, ctx.now(), id);
  return ctx.db.prepare('SELECT * FROM charges WHERE id = ?').get(id) as ChargeRow;
}

/** Quotas and dates of a new period on a tariff. Премиум includes a week of roaming. */
function startPeriod(ctx: Ctx, lineId: string, t: Tariff, start: number, periodNo: number) {
  const q = quotas(t);
  ctx.db
    .prepare(
      `UPDATE lines SET tariff = ?, next_tariff = NULL, status = 'active', block_reason = NULL, retry_at = NULL, period_no = ?, period_start = ?, period_end = ?,
       minutes_left = ?, mb_left = ?, sms_left = ?, minutes_used = 0, mb_used = 0, sms_used = 0, low_data_sent = 0,
       roaming_until = CASE WHEN ? THEN MAX(COALESCE(roaming_until, 0), ?) ELSE roaming_until END WHERE id = ?`,
    )
    .run(t.id, periodNo, start, start + periodMs(ctx), q.minutes, q.mb, q.sms, t.id === 'premium' ? 1 : 0, start + 7 * DAY, lineId);
}

// ---- Connecting ----

export async function connect(ctx: Ctx, user: SessionUser, input: { number: string; tariff: string }) {
  if (!user.mandateId) throw new HttpError(403, 'Привяжите счёт Bobobank, чтобы подключиться', 'no_mandate');
  if (openLine(ctx, user.id)) throw new HttpError(409, 'У вас уже есть номер Бобтелекома', 'has_line');
  const n = normalize(input.number);
  if (!n) throw new HttpError(400, 'Номер должен быть вида +123 XXX XXX-XX-XX', 'bad_number');
  const t = tariffOf(ctx, input.tariff);
  if (!t) throw new HttpError(400, 'Нет такого тарифа');
  assertFree(ctx, n);
  const numberCost = t.id === 'premium' ? Math.round(numberPrice(n) / 2) : numberPrice(n);
  const now = ctx.now();
  const id = newId('line', 12);
  const q = quotas(t);
  try {
    ctx.db
      .prepare(
        `INSERT INTO lines(id, user_id, number, tariff, status, period_start, period_end, minutes_left, mb_left, sms_left, esim, data_at, created_at)
         VALUES(?,?,?,?,'connecting',?,?,?,?,?,?,?,?)`,
      )
      .run(id, user.id, n, t.id, now, now + periodMs(ctx), q.minutes, q.mb, q.sms, `LPA:1$esim.bobtelecom.local$${randomDigits(20)}`, now + DATA_EVERY_MS, now);
  } catch {
    throw new HttpError(409, 'Этот номер уже заняли — выберите другой', 'number_taken');
  }
  const line = lineById(ctx, id);
  let numberCharge: ChargeRow | null = null;
  try {
    if (numberCost > 0) numberCharge = await pay(ctx, user, line, 'number', `красивый номер ${formatNumber(n)}`, numberCost, `number_${id}`);
    await pay(ctx, user, line, 'subscription', `тариф «${t.title}», первый месяц`, t.price, `sub_${id}_1`);
  } catch (e) {
    // The number was paid but the first month was not: give the number money back, free the number.
    if (numberCharge?.bank_id) {
      await refund(ctx, numberCharge.bank_id, numberCharge.amount, `refund_${numberCharge.id}`)
        .then(() => ctx.db.prepare(`UPDATE charges SET status = 'refunded', refunded = amount WHERE id = ?`).run(numberCharge!.id))
        .catch(() => undefined);
    }
    ctx.db.prepare(`UPDATE lines SET status = 'closed', closed_at = ? WHERE id = ?`).run(ctx.now(), id);
    throw e;
  }
  startPeriod(ctx, id, t, now, 1);
  notifyLine(ctx, n, `Добро пожаловать в Бобтелеком! Ваш номер ${formatNumber(n)}, тариф «${t.title}». Следующее списание ${rub(t.price)} — ${date(now + periodMs(ctx))}.`);
  return lineById(ctx, id);
}

// ---- Tariffs and add-ons ----

/** «Сразу»: a new period starts now and is paid in full. «Со следующего периода»: nothing is charged now. */
export async function changeTariff(ctx: Ctx, user: SessionUser, tariffId: string, when: 'now' | 'next') {
  const line = requireLine(ctx, user.id);
  const t = tariffOf(ctx, tariffId);
  if (!t) throw new HttpError(400, 'Нет такого тарифа');
  if (when === 'next') {
    ctx.db.prepare('UPDATE lines SET next_tariff = ? WHERE id = ?').run(t.id === line.tariff ? null : t.id, line.id);
    return lineById(ctx, line.id);
  }
  if (t.id === line.tariff && line.status === 'active') throw new HttpError(409, 'Этот тариф уже подключён');
  await pay(ctx, user, line, 'change', `переход на тариф «${t.title}»`, t.price, `sub_${line.id}_${line.period_no + 1}`);
  startPeriod(ctx, line.id, t, ctx.now(), line.period_no + 1);
  notifyLine(ctx, line.number, `Тариф «${t.title}» подключён. Новый период до ${date(ctx.now() + periodMs(ctx))}.`);
  return lineById(ctx, line.id);
}

export async function buyAddon(ctx: Ctx, user: SessionUser, addonId: string) {
  const line = requireLine(ctx, user.id);
  if (line.status !== 'active') throw new HttpError(409, 'Номер заблокирован — сначала оплатите связь', 'blocked');
  const a = addonOf(ctx, addonId);
  if (!a) throw new HttpError(400, 'Нет такого пакета');
  const n = (ctx.db.prepare(`SELECT COUNT(*) c FROM charges WHERE line_id = ? AND kind = 'addon'`).get(line.id) as { c: number }).c + 1;
  await pay(ctx, user, line, 'addon', `пакет «${a.title}»`, a.price, `addon_${line.id}_${n}`);
  const add = (left: number, extra?: number) => (left < 0 || !extra ? left : left + extra);
  const until = a.roamingDays ? Math.max(line.roaming_until ?? 0, ctx.now()) + a.roamingDays * DAY : line.roaming_until;
  ctx.db
    .prepare('UPDATE lines SET minutes_left = ?, mb_left = ?, sms_left = ?, roaming_until = ?, low_data_sent = 0 WHERE id = ?')
    .run(add(line.minutes_left, a.minutes), add(line.mb_left, a.gb ? a.gb * 1024 : undefined), add(line.sms_left, a.sms), until, line.id);
  return lineById(ctx, line.id);
}

/** A blocked number: the subscriber pays now instead of waiting for the hourly retry. */
export async function payNow(ctx: Ctx, user: SessionUser) {
  const line = requireLine(ctx, user.id);
  if (line.status !== 'blocked' || line.block_reason === 'admin') throw new HttpError(409, 'Номер не заблокирован за неуплату');
  return renew(ctx, line, true);
}

export function closeLine(ctx: Ctx, user: SessionUser) {
  const line = requireLine(ctx, user.id);
  ctx.db.prepare(`UPDATE lines SET status = 'closed', closed_at = ? WHERE id = ?`).run(ctx.now(), line.id);
  ctx.db.prepare(`UPDATE calls SET status = 'ended', ended_at = ? WHERE status IN ('ringing', 'active') AND (from_number = ? OR to_number = ?)`).run(ctx.now(), line.number, line.number);
}

// ---- Billing ----

/** Monthly fee for the next period (the tariff chosen for it, if any). Failing that, the number is blocked. */
async function renew(ctx: Ctx, line: LineRow, manual = false) {
  const u = ctx.db.prepare('SELECT id, mandate_id FROM users WHERE id = ?').get(line.user_id) as { id: string; mandate_id: string | null };
  const t = tariffOf(ctx, line.next_tariff ?? line.tariff) ?? tariffOf(ctx, line.tariff)!;
  const no = line.period_no + 1;
  const now = ctx.now();
  try {
    await pay(ctx, { id: u.id, mandateId: u.mandate_id }, line, 'subscription', `тариф «${t.title}», абонентская плата`, t.price, `sub_${line.id}_${no}`);
  } catch (e) {
    if (e instanceof BankDown && !manual) {
      ctx.db.prepare('UPDATE lines SET retry_at = ? WHERE id = ?').run(now + RETRY_DOWN_MS, line.id);
      return lineById(ctx, line.id);
    }
    if (line.status === 'active') {
      ctx.db.prepare(`UPDATE lines SET status = 'blocked', block_reason = ?, retry_at = ? WHERE id = ?`).run(u.mandate_id ? 'debt' : 'no_mandate', now + RETRY_DEBT_MS, line.id);
      notifyLine(ctx, line.number, `Не получилось списать ${rub(t.price)} за тариф «${t.title}»: ${(e as Error).message} Номер заблокирован — оплатите связь в приложении, и он сразу заработает.`);
    } else {
      ctx.db.prepare('UPDATE lines SET retry_at = ? WHERE id = ?').run(now + RETRY_DEBT_MS, line.id);
    }
    if (manual) throw e;
    return lineById(ctx, line.id);
  }
  // On time — the new period follows the old one; after a block it starts from the payment.
  const start = line.status === 'active' && now - line.period_end < periodMs(ctx) ? line.period_end : now;
  startPeriod(ctx, line.id, t, start, no);
  notifyLine(ctx, line.number, `${line.status === 'blocked' ? 'Связь восстановлена. ' : ''}Списали ${rub(t.price)} за тариф «${t.title}». Следующее списание — ${date(start + periodMs(ctx))}.`);
  return lineById(ctx, line.id);
}

/** Simulated phone in the pocket: apps use a little mobile data. */
function useData(ctx: Ctx, line: LineRow) {
  const mb = 2 + Math.floor(ctx.random() * 24);
  const left = line.mb_left < 0 ? -1 : Math.max(0, line.mb_left - mb);
  const used = line.mb_left < 0 ? mb : Math.min(mb, line.mb_left);
  ctx.db.prepare('UPDATE lines SET mb_left = ?, mb_used = mb_used + ?, data_at = ? WHERE id = ?').run(left, used, ctx.now() + DATA_EVERY_MS, line.id);
  if (used > 0) ctx.db.prepare('INSERT INTO data_usage(line_id, day, mb) VALUES(?,?,?) ON CONFLICT(line_id, day) DO UPDATE SET mb = mb + excluded.mb').run(line.id, mskDay(ctx.now()), used);
  if (line.mb_left >= 0 && left < 512 && !line.low_data_sent) {
    ctx.db.prepare('UPDATE lines SET low_data_sent = 1 WHERE id = ?').run(line.id);
    notifyLine(ctx, line.number, left === 0 ? 'Интернет по тарифу закончился. Подключите пакет «+10 ГБ» в приложении.' : `Осталось меньше 512 МБ интернета. Пакет «+10 ГБ» — в приложении.`);
  }
}

export async function tick(ctx: Ctx) {
  const now = ctx.now();
  const due = ctx.db
    .prepare(
      `SELECT * FROM lines WHERE (status = 'active' AND period_end <= ? AND (retry_at IS NULL OR retry_at <= ?))
         OR (status = 'blocked' AND block_reason != 'admin' AND retry_at <= ?) LIMIT 50`,
    )
    .all(now, now, now) as LineRow[];
  for (const l of due) await renew(ctx, l);
  for (const l of ctx.db.prepare(`SELECT * FROM lines WHERE status = 'active' AND data_at <= ? LIMIT 200`).all(now) as LineRow[]) useData(ctx, l);
}

// ---- Views ----

export function lineView(ctx: Ctx, l: LineRow) {
  const t = tariffOf(ctx, l.tariff);
  const next = l.next_tariff ? tariffOf(ctx, l.next_tariff) : null;
  const q = t ? quotas(t) : { minutes: 0, mb: 0, sms: 0 };
  return {
    id: l.id,
    number: l.number,
    formatted: formatNumber(l.number),
    status: l.status,
    blockReason: l.block_reason,
    tariff: t ?? { id: l.tariff, title: l.tariff, price: 0, minutes: 0, gb: 0, sms: 0, perks: [] },
    nextTariff: next ?? null,
    periodStart: l.period_start,
    periodEnd: l.period_end,
    nextCharge: { at: l.status === 'blocked' ? null : l.period_end, amount: (next ?? t)?.price ?? 0 },
    left: { minutes: l.minutes_left, mb: l.mb_left, sms: l.sms_left },
    used: { minutes: l.minutes_used, mb: l.mb_used, sms: l.sms_used },
    total: q,
    roamingUntil: l.roaming_until && l.roaming_until > ctx.now() ? l.roaming_until : null,
    esim: l.esim,
    createdAt: l.created_at,
  };
}

export const chargeView = (c: ChargeRow) => ({ id: c.id, kind: c.kind, title: c.title, amount: c.amount, status: c.status, error: c.error, refunded: c.refunded, createdAt: c.created_at, paidAt: c.paid_at });
