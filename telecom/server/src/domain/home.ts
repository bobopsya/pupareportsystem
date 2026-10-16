import { HttpError, type Ctx, type SessionUser } from '../context.js';
import { newId, randomDigits, safeJson, sha256 } from '../util.js';
import { BankDown, refund } from './bank.js';
import { notifyLine, openLine, payFor, periodMs, type ChargeRow } from './lines.js';
import { bundlePrice, getSettings, homeTariffOf, ROUTER, type HomeTariff } from './plans.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** Install windows: two hours each, 9:00–21:00 Moscow time, from tomorrow for a week. */
const SLOT_HOURS = [9, 11, 13, 15, 17, 19];
const MSK = 3 * HOUR;
const MASTERS = ['Алексей', 'Дмитрий', 'Сергей', 'Иван', 'Михаил', 'Артём', 'Никита', 'Павел'];

export type Router = 'own' | 'rent' | 'buy';

export interface Address {
  street: string;
  house: string;
  flat: string;
}

export interface HomeRow {
  id: string;
  user_id: string;
  contract: string;
  tariff: string;
  next_tariff: string | null;
  status: 'scheduled' | 'active' | 'blocked' | 'closed';
  block_reason: string | null;
  address: string;
  router: Router;
  bundle: number;
  install_at: number;
  master: string;
  master_sent: number;
  installed_at: number | null;
  period_no: number;
  period_start: number | null;
  period_end: number | null;
  retry_at: number | null;
  gb_used: number;
  data_at: number | null;
  created_at: number;
  closed_at: number | null;
}

const clean = (s: string) => s.trim().replace(/\s+/g, ' ');
export const addressText = (a: Address) => `${a.street}, д. ${a.house}${a.flat ? `, кв. ${a.flat}` : ''}`;

/** Is the house connected? A fixed answer per house (≈85% are), so asking twice gives the same result. */
export function coverage(a: Address) {
  const key = `${clean(a.street).toLowerCase()}|${clean(a.house).toLowerCase()}`;
  const h = parseInt(sha256(key).slice(0, 8), 16);
  const ok = h % 100 < 85;
  const tech = ok ? (h % 3 === 0 ? 'GPON' : 'FTTB') : null;
  return { ok, tech, address: addressText(a) };
}

/** Free two-hour windows for the master (taken ones are skipped). */
export function slots(ctx: Ctx) {
  const now = ctx.now();
  const startOfDay = Math.floor((now + MSK) / DAY) * DAY - MSK;
  const out: { at: number; until: number; free: boolean }[] = [];
  for (let d = 1; d <= 7; d++) {
    for (const h of SLOT_HOURS) {
      const at = startOfDay + d * DAY + h * HOUR;
      // A crew does three flats per window.
      const busy = (ctx.db.prepare(`SELECT COUNT(*) c FROM homes WHERE status = 'scheduled' AND install_at = ?`).get(at) as { c: number }).c;
      out.push({ at, until: at + 2 * HOUR, free: busy < 3 });
    }
  }
  return out;
}

export const openHome = (ctx: Ctx, userId: string) => ctx.db.prepare(`SELECT * FROM homes WHERE user_id = ? AND status != 'closed' ORDER BY created_at DESC LIMIT 1`).get(userId) as HomeRow | undefined;
const homeById = (ctx: Ctx, id: string) => ctx.db.prepare('SELECT * FROM homes WHERE id = ?').get(id) as HomeRow;

/** The home fee: 20% off while the person also has an active Бобтелеком number. */
function fee(ctx: Ctx, userId: string, t: HomeTariff) {
  const bundle = openLine(ctx, userId)?.status === 'active';
  return { price: bundle ? bundlePrice(t.price) : t.price, bundle };
}

/** SMS to the person's mobile number, if they have one. */
function tell(ctx: Ctx, userId: string, text: string) {
  const l = openLine(ctx, userId);
  if (l) notifyLine(ctx, l.number, text);
}

const rub = (r: number) => `${r.toLocaleString('ru-RU')} ₽`;
const when = (ts: number) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(ts).replace(' в ', ', ');

export async function orderHome(ctx: Ctx, user: SessionUser, input: { tariff: string; address: Address; router: Router; installAt: number }) {
  if (!user.mandateId) throw new HttpError(403, 'Привяжите счёт Bobobank, чтобы подключиться', 'no_mandate');
  if (openHome(ctx, user.id)) throw new HttpError(409, 'Домашний интернет уже подключён или заявка в работе', 'has_home');
  const t = homeTariffOf(ctx, input.tariff);
  if (!t) throw new HttpError(400, 'Нет такого тарифа');
  const a = { street: clean(input.address.street), house: clean(input.address.house), flat: clean(input.address.flat) };
  if (a.street.length < 3 || !a.house) throw new HttpError(400, 'Укажите улицу и дом', 'bad_address');
  if (!coverage(a).ok) throw new HttpError(409, 'В этот дом мы пока не провели кабель. Оставьте другой адрес.', 'no_coverage');
  const slot = slots(ctx).find((s) => s.at === input.installAt);
  if (!slot || !slot.free) throw new HttpError(409, 'Это время уже занято — выберите другое', 'slot_taken');
  const { price, bundle } = fee(ctx, user.id, t);
  const id = newId('home', 12);
  const contract = `БТ-${randomDigits(8)}`;
  const master = MASTERS[Math.floor(ctx.random() * MASTERS.length)];
  ctx.db
    .prepare(
      `INSERT INTO homes(id, user_id, contract, tariff, status, address, router, bundle, install_at, master, created_at)
       VALUES(?,?,?,?,'scheduled',?,?,?,?,?,?)`,
    )
    .run(id, user.id, contract, t.id, JSON.stringify(a), input.router, bundle ? 1 : 0, input.installAt, master, ctx.now());
  const target = { lineId: null, homeId: id, subtitle: `Договор ${contract}` };
  const paid: ChargeRow[] = [];
  try {
    paid.push(await payFor(ctx, user, target, 'home', `домашний интернет «${t.title}», первый месяц${bundle ? ' (вместе с мобильной −20%)' : ''}`, price, `home_${id}_1`));
    if (input.router === 'buy') paid.push(await payFor(ctx, user, target, 'router', 'Wi‑Fi роутер, покупка', ROUTER.buy, `router_${id}`));
    if (input.router === 'rent') paid.push(await payFor(ctx, user, target, 'router', 'аренда Wi‑Fi роутера, первый месяц', ROUTER.rent, `router_${id}_1`));
  } catch (e) {
    await refundAll(ctx, paid);
    ctx.db.prepare(`UPDATE homes SET status = 'closed', closed_at = ? WHERE id = ?`).run(ctx.now(), id);
    throw e;
  }
  tell(ctx, user.id, `Заявка на домашний интернет «${t.title}» принята, договор ${contract}. Мастер ${master} приедет ${when(input.installAt)}–${when(input.installAt + 2 * HOUR).slice(-5)} по адресу ${addressText(a)}.`);
  return homeById(ctx, id);
}

async function refundAll(ctx: Ctx, charges: ChargeRow[]) {
  for (const c of charges) {
    if (!c.bank_id || c.status !== 'paid') continue;
    await refund(ctx, c.bank_id, c.amount - c.refunded, `refund_${c.id}`)
      .then(() => ctx.db.prepare(`UPDATE charges SET status = 'refunded', refunded = amount WHERE id = ?`).run(c.id))
      .catch(() => undefined);
  }
}

/** Before the master came: the money goes back. After: the contract ends, the paid month is not returned. */
export async function cancelHome(ctx: Ctx, user: SessionUser) {
  const h = openHome(ctx, user.id);
  if (!h) throw new HttpError(404, 'Домашнего интернета нет');
  if (h.status === 'scheduled') {
    const paid = ctx.db.prepare(`SELECT * FROM charges WHERE home_id = ? AND status = 'paid'`).all(h.id) as ChargeRow[];
    await refundAll(ctx, paid);
    tell(ctx, user.id, `Заявка на домашний интернет отменена, ${rub(paid.reduce((s, c) => s + c.amount, 0) / 100)} вернули на счёт Bobobank.`);
  } else {
    tell(ctx, user.id, `Договор домашнего интернета ${h.contract} расторгнут.${h.router === 'rent' ? ' Роутер заберёт мастер — договоритесь в чате поддержки.' : ''}`);
  }
  ctx.db.prepare(`UPDATE homes SET status = 'closed', closed_at = ? WHERE id = ?`).run(ctx.now(), h.id);
}

export function changeHomeTariff(ctx: Ctx, user: SessionUser, tariffId: string) {
  const h = openHome(ctx, user.id);
  if (!h) throw new HttpError(404, 'Домашнего интернета нет');
  const t = homeTariffOf(ctx, tariffId);
  if (!t) throw new HttpError(400, 'Нет такого тарифа');
  if (h.status === 'scheduled') {
    ctx.db.prepare('UPDATE homes SET tariff = ? WHERE id = ?').run(t.id, h.id);
    return homeById(ctx, h.id);
  }
  ctx.db.prepare('UPDATE homes SET next_tariff = ? WHERE id = ?').run(t.id === h.tariff ? null : t.id, h.id);
  return homeById(ctx, h.id);
}

/** The monthly fee for the flat (and the router rent). Failing that, the internet is switched off until paid. */
async function renewHome(ctx: Ctx, h: HomeRow, manual = false) {
  const u = ctx.db.prepare('SELECT id, mandate_id FROM users WHERE id = ?').get(h.user_id) as { id: string; mandate_id: string | null };
  const t = homeTariffOf(ctx, h.next_tariff ?? h.tariff) ?? homeTariffOf(ctx, h.tariff)!;
  const { price, bundle } = fee(ctx, h.user_id, t);
  const no = h.period_no + 1;
  const now = ctx.now();
  const target = { lineId: null, homeId: h.id, subtitle: `Договор ${h.contract}` };
  try {
    await payFor(ctx, { id: u.id, mandateId: u.mandate_id }, target, 'home', `домашний интернет «${t.title}»${bundle ? ' (вместе с мобильной −20%)' : ''}`, price, `home_${h.id}_${no}`);
    if (h.router === 'rent') await payFor(ctx, { id: u.id, mandateId: u.mandate_id }, target, 'router', 'аренда Wi‑Fi роутера', ROUTER.rent, `router_${h.id}_${no}`);
  } catch (e) {
    if (e instanceof BankDown && !manual) {
      ctx.db.prepare('UPDATE homes SET retry_at = ? WHERE id = ?').run(now + 60_000, h.id);
      return homeById(ctx, h.id);
    }
    if (h.status === 'active') tell(ctx, h.user_id, `Не получилось оплатить домашний интернет: ${(e as Error).message} Интернет дома выключен до оплаты.`);
    ctx.db.prepare(`UPDATE homes SET status = 'blocked', block_reason = 'debt', retry_at = ? WHERE id = ?`).run(now + HOUR, h.id);
    if (manual) throw e;
    return homeById(ctx, h.id);
  }
  const start = h.status === 'active' && h.period_end && now - h.period_end < periodMs(ctx) ? h.period_end : now;
  ctx.db
    .prepare(`UPDATE homes SET status = 'active', block_reason = NULL, retry_at = NULL, tariff = ?, next_tariff = NULL, bundle = ?, period_no = ?, period_start = ?, period_end = ? WHERE id = ?`)
    .run(t.id, bundle ? 1 : 0, no, start, start + periodMs(ctx), h.id);
  if (h.status === 'blocked') tell(ctx, h.user_id, 'Домашний интернет снова работает — спасибо за оплату.');
  return homeById(ctx, h.id);
}

export async function payHomeNow(ctx: Ctx, user: SessionUser) {
  const h = openHome(ctx, user.id);
  if (!h || h.status !== 'blocked') throw new HttpError(409, 'Домашний интернет не заблокирован');
  return renewHome(ctx, h, true);
}

export async function tickHomes(ctx: Ctx) {
  const now = ctx.now();
  // The master is on the way an hour before the window; the internet works when the window ends.
  for (const h of ctx.db.prepare(`SELECT * FROM homes WHERE status = 'scheduled' AND master_sent = 0 AND install_at - ? <= ?`).all(HOUR, now) as HomeRow[]) {
    ctx.db.prepare('UPDATE homes SET master_sent = 1 WHERE id = ?').run(h.id);
    tell(ctx, h.user_id, `Мастер ${h.master} выехал к вам и будет в течение часа. Договор ${h.contract}.`);
  }
  for (const h of ctx.db.prepare(`SELECT * FROM homes WHERE status = 'scheduled' AND install_at + ? <= ?`).all(2 * HOUR, now) as HomeRow[]) {
    const at = h.install_at + 2 * HOUR;
    ctx.db
      .prepare(`UPDATE homes SET status = 'active', installed_at = ?, period_start = ?, period_end = ?, data_at = ?, master_sent = 1 WHERE id = ? AND status = 'scheduled'`)
      .run(at, at, at + periodMs(ctx), at + HOUR, h.id);
    const t = homeTariffOf(ctx, h.tariff);
    tell(ctx, h.user_id, `Домашний интернет подключён: «${t?.title ?? h.tariff}», до ${t?.speed ?? '?'} Мбит/с. Сеть Wi‑Fi: Bobtelecom-${h.contract.slice(-4)}.`);
  }
  for (const h of ctx.db
    .prepare(`SELECT * FROM homes WHERE (status = 'active' AND period_end <= ? AND (retry_at IS NULL OR retry_at <= ?)) OR (status = 'blocked' AND retry_at <= ?) LIMIT 50`)
    .all(now, now, now) as HomeRow[])
    await renewHome(ctx, h);
  // Traffic at home: a few gigabytes a day, counted every hour.
  for (const h of ctx.db.prepare(`SELECT * FROM homes WHERE status = 'active' AND data_at <= ? LIMIT 200`).all(now) as HomeRow[]) {
    ctx.db.prepare('UPDATE homes SET gb_used = gb_used + ?, data_at = ? WHERE id = ?').run(Math.round((0.05 + ctx.random() * 0.35) * 100) / 100, now + HOUR, h.id);
  }
}

export function speedtest(ctx: Ctx, user: SessionUser) {
  const h = openHome(ctx, user.id);
  if (!h || h.status !== 'active') throw new HttpError(409, 'Тест скорости — после подключения интернета', 'not_active');
  const t = homeTariffOf(ctx, h.tariff)!;
  const down = Math.round(t.speed * (0.85 + ctx.random() * 0.13) * 10) / 10;
  return { down, up: Math.round(down * (0.86 + ctx.random() * 0.08) * 10) / 10, ping: 3 + Math.floor(ctx.random() * 7), server: 'Москва, Бобтелеком', at: ctx.now() };
}

export function homeView(ctx: Ctx, h: HomeRow) {
  const s = getSettings(ctx);
  const t = homeTariffOf(ctx, h.tariff) ?? { id: h.tariff, title: h.tariff, speed: 0, price: 0, perks: [] };
  const next = h.next_tariff ? homeTariffOf(ctx, h.next_tariff) : null;
  const { price, bundle } = fee(ctx, h.user_id, next ?? t);
  const now = ctx.now();
  return {
    id: h.id,
    contract: h.contract,
    status: h.status,
    stage: h.status === 'scheduled' ? (h.master_sent || h.install_at - HOUR <= now ? 'master' : 'booked') : h.status,
    blockReason: h.block_reason,
    tariff: t,
    nextTariff: next ?? null,
    address: safeJson<Address>(h.address, { street: '', house: '', flat: '' }),
    addressText: addressText(safeJson<Address>(h.address, { street: '', house: '', flat: '' })),
    router: h.router,
    routerRent: s.homeTariffs.length ? ROUTER.rent : 0,
    master: h.master,
    installAt: h.install_at,
    installUntil: h.install_at + 2 * HOUR,
    installedAt: h.installed_at,
    periodEnd: h.period_end,
    nextCharge: h.status === 'active' && h.period_end ? { at: h.period_end, amount: price + (h.router === 'rent' ? ROUTER.rent : 0), bundle } : null,
    gbUsed: Math.round(h.gb_used * 10) / 10,
    wifi: `Bobtelecom-${h.contract.slice(-4)}`,
    createdAt: h.created_at,
  };
}

/** Prices for the order form: each tariff with and without the mobile bundle. */
export function homeOffer(ctx: Ctx, userId: string | null) {
  const bundle = userId ? openLine(ctx, userId)?.status === 'active' : false;
  return { tariffs: getSettings(ctx).homeTariffs.map((t) => ({ ...t, bundlePrice: bundlePrice(t.price) })), router: ROUTER, bundle, discount: 20 };
}
