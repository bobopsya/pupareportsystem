import { HttpError, type Ctx } from '../context.js';
import { newAccountNumber } from './bank.js';
import { getAccount, mainAccount, notify, post, systemAccount, type AccountRow } from './ledger.js';
import { humanMoney } from './money.js';
import { systemMessage } from './support.js';
import { getUser, shortName } from './transfers.js';
import { newId, safeJson } from '../util.js';

/**
 * Бобуслуги — the state services site on Supabase. The bank talks to it with the service key
 * (svc_* functions); Бобуслуги never call the bank, they leave orders that the bank picks up.
 */
export const gosEnabled = (ctx: Ctx) => !!(ctx.cfg.supabaseUrl && ctx.cfg.supabaseServiceKey && ctx.cfg.gosPublicUrl);

export class GosError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const GOS_MESSAGES: Record<string, string> = {
  E_BAD_CODE: 'Ссылка входа устарела — попробуйте ещё раз',
  E_NOT_FOUND: 'Не найдено на Бобуслугах',
  E_BAD_STATUS: 'Штраф уже оплачен или отменён',
  E_NO_MONEY: 'Недостаточно псякоинов',
  E_BAD_AMOUNT: 'Некорректная сумма',
};

/** Calls an svc_* function of Бобуслуги. Errors come back as E_* codes. */
export async function gosRpc<T>(ctx: Ctx, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!gosEnabled(ctx)) throw new HttpError(503, 'Бобуслуги не подключены к банку');
  const key = ctx.cfg.supabaseServiceKey;
  const headers: Record<string, string> = { 'content-type': 'application/json', apikey: key };
  // Legacy keys are JWTs and go in Authorization as well; new sb_secret_ keys go only in apikey.
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`;
  let res: Response;
  try {
    res = await ctx.http(`${ctx.cfg.supabaseUrl}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args), signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new HttpError(502, 'Бобуслуги не отвечают, попробуйте позже');
  }
  const text = await res.text();
  const data = safeJson<unknown>(text, null);
  if (!res.ok) {
    const msg = String((data as { message?: string } | null)?.message ?? '');
    const code = /^E_[A-Z_]+$/.test(msg) ? msg : 'E_GOS';
    throw new GosError(code, GOS_MESSAGES[code] ?? 'Бобуслуги вернули ошибку');
  }
  return data as T;
}

export interface GosBusiness {
  id: number;
  number: string;
  country_code: string;
  name: string;
  org_type: 'ИП' | 'Компания';
  inn: string;
  activity?: string;
}

export interface GosPerson {
  id: string;
  login: string;
  display_name: string;
  role: 'citizen' | 'official' | 'president' | 'superadmin';
  country_code: string | null;
  gov_country_code: string | null;
  banned: boolean;
  balance: number;
  passport: { number: string; country_code: string; last_name: string; first_name: string; patronymic?: string; birth_date: string; sex?: string; issuer?: string } | null;
  businesses: GosBusiness[];
}

export interface GosSettings {
  psy_rub_rate: number;
  countries: { code: string; name: string; psy_name: string }[];
}

export const fullName = (p: GosPerson) => (p.passport ? `${p.passport.first_name} ${p.passport.last_name}`.trim() : p.display_name);

/** Saves what the bank knows about the person from Бобуслуги. */
export function saveGos(ctx: Ctx, userId: string, p: GosPerson) {
  ctx.db
    .prepare('UPDATE users SET gos_uid = ?, gos_login = ?, passport = ?, gos_role = ?, gos_country = ?, gos_checked_at = ? WHERE id = ?')
    .run(p.id, p.login, p.passport ? JSON.stringify(p.passport) : null, p.role, p.gov_country_code, ctx.now(), userId);
}

export interface GosUserRow {
  id: string;
  name: string;
  gos_uid: string | null;
  gos_login: string | null;
  passport: string | null;
  gos_role: string | null;
  gos_country: string | null;
  gos_checked_at: number | null;
}

export const gosUser = (ctx: Ctx, userId: string) => ctx.db.prepare('SELECT id, name, gos_uid, gos_login, passport, gos_role, gos_country, gos_checked_at FROM users WHERE id = ?').get(userId) as GosUserRow | undefined;
export const userByGosUid = (ctx: Ctx, uid: string) => ctx.db.prepare(`SELECT id, name, gos_uid, gos_login, passport, gos_role, gos_country, gos_checked_at FROM users WHERE gos_uid = ? AND role = 'client'`).get(uid) as GosUserRow | undefined;

/** Identity check: with Бобуслуги connected, new products need a valid Бобопаспорт. */
export function kycStatus(ctx: Ctx, userId: string) {
  if (!gosEnabled(ctx)) return { required: false, ok: true } as const;
  const u = gosUser(ctx, userId);
  const passport = safeJson<GosPerson['passport']>(u?.passport, null);
  return { required: true, ok: !!(u?.gos_uid && passport), linked: !!u?.gos_uid, passport, login: u?.gos_login ?? null, role: u?.gos_role ?? null, country: u?.gos_country ?? null };
}

export function requireKyc(ctx: Ctx, userId: string) {
  const k = kycStatus(ctx, userId);
  if (!k.ok) throw new HttpError(403, k.linked ? 'Нужен действующий Бобопаспорт: оформите его на Бобуслугах' : 'Подтвердите личность через Бобуслуги — это займёт минуту', 'kyc_required');
}

/** Refreshes the passport and role from Бобуслуги (on sign-in and once a day). */
export async function refreshPerson(ctx: Ctx, userId: string): Promise<GosPerson | null> {
  const u = gosUser(ctx, userId);
  if (!u?.gos_uid || !gosEnabled(ctx)) return null;
  const p = await gosRpc<GosPerson>(ctx, 'svc_person', { p_user: u.gos_uid });
  saveGos(ctx, userId, p);
  return p;
}

// ---------- Treasury ----------

/** A country's treasury account in roubles: fines and fees paid from the bank land here, salaries leave from here. */
export function treasuryAccount(ctx: Ctx, country: string, name?: string): AccountRow {
  const code = `treasury:${country}`;
  let row = ctx.db.prepare('SELECT * FROM accounts WHERE system_code = ?').get(code) as AccountRow | undefined;
  if (!row) {
    const id = newId('acc', 16);
    ctx.db
      .prepare(`INSERT INTO accounts(id, number, user_id, kind, currency, name, system_code, created_at) VALUES(?,?,NULL,'system','RUB',?,?,?)`)
      .run(id, newAccountNumber('40101', 'RUB'), `Казна ${name ?? country}`, code, ctx.now());
    row = getAccount(ctx, id)!;
  } else if (name && row.name !== `Казна ${name}`) {
    ctx.db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(`Казна ${name}`, row.id);
  }
  return row;
}

// ---------- Fines ----------

export interface GosFine {
  id: number;
  user_id: string;
  login: string;
  display_name: string;
  country_code: string | null;
  country_name: string | null;
  amount: number;
  amount_rub: number;
  reason: string;
  kind: string;
  status: 'unpaid' | 'paid' | 'cancelled';
  beneficiary_id: string | null;
}

/** Where the money for a fine goes: the plaintiff's account for court awards, the country's treasury otherwise. */
function fineRecipient(ctx: Ctx, f: GosFine): AccountRow {
  if (f.beneficiary_id) {
    const b = userByGosUid(ctx, f.beneficiary_id);
    const acc = b && mainAccount(ctx, b.id);
    if (acc) return acc;
  }
  return treasuryAccount(ctx, f.country_code ?? 'BOBO', f.country_name ?? undefined);
}

export async function payFine(ctx: Ctx, userId: string, acc: AccountRow, fineId: number) {
  const f = await gosRpc<GosFine>(ctx, 'svc_fine', { p_id: fineId });
  if (f.status !== 'unpaid') throw new HttpError(400, f.status === 'paid' ? 'Штраф уже оплачен' : 'Штраф отменён');
  if (acc.currency !== 'RUB') throw new HttpError(400, 'Штрафы оплачиваются со счёта в рублях');
  const to = fineRecipient(ctx, f);
  const payer = getUser(ctx, userId)!;
  const what = f.kind === 'tax' ? 'Налог' : f.kind === 'court' ? 'Взыскание по суду' : 'Штраф';
  const id = newId('gfp', 16);
  const txId = post(ctx, {
    kind: 'gos_fine',
    description: `${what}: ${f.reason}`,
    initiatorId: userId,
    meta: { fineId: f.id, coins: f.amount, payment: id },
    legs: [
      { account: acc, amount: -f.amount_rub, title: `Бобуслуги · ${f.country_name ?? 'штраф'}`, subtitle: `${what}: ${f.reason}`, category: 'other' },
      { account: to, amount: f.amount_rub, title: to.user_id ? shortName(payer.name) : `${what} №${f.id}`, subtitle: to.user_id ? `Взыскание по суду: ${f.reason}` : `${f.display_name} (${f.login})`, category: 'income' },
    ],
  });
  ctx.db.prepare('INSERT INTO gos_fine_payments(id, fine_id, user_id, account_id, amount, tx_id, status, created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, f.id, userId, acc.id, f.amount_rub, txId, 'processing', ctx.now());
  try {
    await gosRpc(ctx, 'svc_fine_paid', { p_id: f.id, p_op: id, p_rub: f.amount_rub });
  } catch (e) {
    post(ctx, {
      kind: 'gos_fine_reversal',
      description: 'Возврат: Бобуслуги не приняли оплату',
      meta: { payment: id },
      legs: [
        { account: getAccount(ctx, to.id)!, amount: -f.amount_rub, force: true },
        { account: getAccount(ctx, acc.id)!, amount: f.amount_rub, title: 'Возврат оплаты штрафа', subtitle: 'Бобуслуги не приняли оплату', category: 'income' },
      ],
    });
    ctx.db.prepare(`UPDATE gos_fine_payments SET status = 'failed' WHERE id = ?`).run(id);
    throw e instanceof GosError ? new HttpError(400, e.message, e.code) : e;
  }
  ctx.db.prepare(`UPDATE gos_fine_payments SET status = 'succeeded' WHERE id = ?`).run(id);
  if (to.user_id) notify(ctx, to.user_id, 'income', `+${humanMoney(f.amount_rub, 'RUB')}`, `Взыскание по суду: ${f.reason}`);
  const entry = ctx.db.prepare('SELECT id FROM entries WHERE tx_id = ? AND account_id = ?').get(txId, acc.id) as { id: number };
  return { entryId: entry.id, fine: f };
}

// ---------- Coin exchange ----------

export const EXCHANGE_SPREAD = 1; // %

export function exchangeQuote(rate: number, coins: number, direction: 'to_rub' | 'to_psy') {
  const base = coins * rate;
  return direction === 'to_rub' ? Math.floor((base * (100 - EXCHANGE_SPREAD)) / 100) : Math.ceil((base * (100 + EXCHANGE_SPREAD)) / 100);
}

export async function exchangeCoins(ctx: Ctx, userId: string, acc: AccountRow, coins: number, direction: 'to_rub' | 'to_psy') {
  requireKyc(ctx, userId);
  if (acc.currency !== 'RUB') throw new HttpError(400, 'Обмен псякоинов — только на счёт в рублях');
  if (!Number.isInteger(coins) || coins < 1 || coins > 1_000_000) throw new HttpError(400, 'Сумма — от 1 до 1 000 000 псякоинов');
  const uid = gosUser(ctx, userId)!.gos_uid!;
  const { psy_rub_rate: rate } = await gosRpc<GosSettings>(ctx, 'svc_settings');
  const rub = exchangeQuote(rate, coins, direction);
  const psy = systemAccount(ctx, 'psy', 'RUB');
  const id = newId('psx', 16);
  const title = 'Обмен псякоинов';
  ctx.db.prepare('INSERT INTO psy_exchanges(id, user_id, account_id, direction, coins, rub, status, created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, userId, acc.id, direction, coins, rub, 'processing', ctx.now());
  const fail = (e: unknown) => {
    ctx.db.prepare(`UPDATE psy_exchanges SET status = 'failed' WHERE id = ?`).run(id);
    return e instanceof GosError ? new HttpError(400, e.message, e.code) : e;
  };
  let txId: string;
  if (direction === 'to_rub') {
    // Coins leave Бобуслуги first: if that fails, nothing happened in the bank.
    try {
      await gosRpc(ctx, 'svc_exchange', { p_user: uid, p_coins: -coins, p_op: id, p_rub: rub });
    } catch (e) {
      throw fail(e);
    }
    try {
      txId = post(ctx, { kind: 'psy_exchange', description: title, initiatorId: userId, meta: { exchange: id, coins }, legs: [
        { account: psy, amount: -rub },
        { account: acc, amount: rub, title, subtitle: `${coins} ПСЯ → рубли`, category: 'income' },
      ] });
    } catch (e) {
      await gosRpc(ctx, 'svc_exchange_revert', { p_op: id }).catch(() => {});
      throw fail(e);
    }
  } else {
    txId = post(ctx, { kind: 'psy_exchange', description: title, initiatorId: userId, meta: { exchange: id, coins }, legs: [
      { account: acc, amount: -rub, title, subtitle: `Рубли → ${coins} ПСЯ`, category: 'transfers' },
      { account: psy, amount: rub },
    ] });
    try {
      await gosRpc(ctx, 'svc_exchange', { p_user: uid, p_coins: coins, p_op: id, p_rub: rub });
    } catch (e) {
      post(ctx, { kind: 'psy_exchange_reversal', description: 'Возврат обмена', meta: { exchange: id }, legs: [
        { account: getAccount(ctx, psy.id)!, amount: -rub, force: true },
        { account: getAccount(ctx, acc.id)!, amount: rub, title: 'Возврат обмена', subtitle: 'Бобуслуги не приняли псякоины', category: 'income' },
      ] });
      throw fail(e);
    }
  }
  ctx.db.prepare(`UPDATE psy_exchanges SET status = 'succeeded', tx_id = ? WHERE id = ?`).run(txId, id);
  return { id, rub, coins, rate };
}

// ---------- Orders from Бобуслуги ----------

interface GosOrder {
  id: number;
  type: 'arrest' | 'lift' | 'collect' | 'salary';
  user_id: string;
  country_code: string | null;
  fine_id: number | null;
  amount_coins: number;
  amount_rub: number;
  reason: string | null;
  beneficiary_id: string | null;
}

function executeOrder(ctx: Ctx, o: GosOrder): { ok: boolean; result: Record<string, unknown> } {
  const u = userByGosUid(ctx, o.user_id);
  if (!u) return { ok: false, result: { error: 'У человека нет счёта в Bobobank' } };
  const acc = mainAccount(ctx, u.id);
  if (o.type === 'arrest') {
    if (!acc) return { ok: false, result: { error: 'Нет платёжного счёта' } };
    const id = newId('rst', 12);
    const comment = `Бобуслуги, штраф №${o.fine_id}: ${o.reason ?? ''}`.slice(0, 300);
    ctx.db.prepare('INSERT INTO restrictions(id, user_id, account_id, type, amount, reason, comment, created_by, created_at) VALUES(?,?,?,?,?,?,?,NULL,?)').run(id, u.id, acc.id, 'arrest', o.amount_rub, 'court', comment, ctx.now());
    const text = `Наложен арест на ${humanMoney(o.amount_rub, 'RUB')} по счёту •• ${acc.number.slice(-4)}. Основание: решение государственного органа Бобуслуг (штраф №${o.fine_id}). Арест снимется сам после оплаты штрафа.`;
    notify(ctx, u.id, 'restriction', 'Арест средств', text);
    systemMessage(ctx, u.id, text, 'Арест средств');
    return { ok: true, result: { restriction: id } };
  }
  if (o.type === 'lift') {
    const arrest = ctx.db.prepare(`SELECT result FROM gos_orders WHERE fine_id = ? AND type = 'arrest' AND ok = 1 ORDER BY id DESC LIMIT 1`).get(o.fine_id) as { result: string } | undefined;
    const rid = safeJson<{ restriction?: string }>(arrest?.result, {}).restriction;
    if (rid) {
      ctx.db.prepare('UPDATE restrictions SET lifted_at = ?, lift_comment = ? WHERE id = ? AND lifted_at IS NULL').run(ctx.now(), 'Штраф оплачен', rid);
      notify(ctx, u.id, 'restriction', 'Арест снят', 'Штраф на Бобуслугах закрыт — деньги снова доступны.');
    }
    return { ok: true, result: { restriction: rid ?? null } };
  }
  if (o.type === 'collect') {
    if (!acc) return { ok: false, result: { error: 'Нет платёжного счёта' } };
    if (acc.balance < o.amount_rub) return { ok: false, result: { error: `Недостаточно средств: на счёте ${humanMoney(Math.max(acc.balance, 0), 'RUB')}` } };
    const f: GosFine = { id: o.fine_id!, user_id: o.user_id, login: '', display_name: u.name, country_code: o.country_code, country_name: null, amount: o.amount_coins, amount_rub: o.amount_rub, reason: o.reason ?? '', kind: 'court', status: 'unpaid', beneficiary_id: o.beneficiary_id };
    const to = fineRecipient(ctx, f);
    const txId = post(ctx, { kind: 'gos_collect', description: `Взыскание по штрафу №${o.fine_id}`, meta: { order: o.id, fineId: o.fine_id }, legs: [
      { account: acc, amount: -o.amount_rub, force: true, title: 'Бобуслуги · взыскание', subtitle: o.reason ?? `Штраф №${o.fine_id}`, category: 'other' },
      { account: to, amount: o.amount_rub, title: to.user_id ? shortName(u.name) : `Взыскание №${o.fine_id}`, subtitle: o.reason ?? '', category: 'income' },
    ] });
    notify(ctx, u.id, 'restriction', 'Списание по требованию государства', `${humanMoney(o.amount_rub, 'RUB')} — ${o.reason ?? `штраф №${o.fine_id}`}`);
    return { ok: true, result: { tx: txId, pay: true } };
  }
  // salary
  if (!acc) return { ok: false, result: { error: 'Нет платёжного счёта' } };
  const t = treasuryAccount(ctx, o.country_code ?? 'BOBO');
  if (t.balance < o.amount_rub) return { ok: false, result: { error: `В казне в банке ${humanMoney(Math.max(t.balance, 0), 'RUB')}, не хватает на зарплату` } };
  const txId = post(ctx, { kind: 'gos_salary', description: 'Зарплата госслужащего', meta: { order: o.id }, legs: [
    { account: t, amount: -o.amount_rub, title: 'Зарплата', subtitle: u.name },
    { account: acc, amount: o.amount_rub, title: t.name, subtitle: 'Зарплата', category: 'income' },
  ] });
  notify(ctx, u.id, 'income', `+${humanMoney(o.amount_rub, 'RUB')}`, `Зарплата из ${t.name.toLowerCase()}`);
  return { ok: true, result: { tx: txId } };
}

/** Picks up orders from Бобуслуги (arrest, lift, collect, salary) and reports back. Safe to repeat. */
export async function processOrders(ctx: Ctx) {
  if (!gosEnabled(ctx)) return 0;
  const orders = await gosRpc<GosOrder[]>(ctx, 'svc_pull_orders', { p_limit: 50 });
  for (const o of orders) {
    let done = ctx.db.prepare('SELECT ok, result FROM gos_orders WHERE id = ?').get(o.id) as { ok: number; result: string } | undefined;
    if (!done) {
      let r: { ok: boolean; result: Record<string, unknown> };
      try {
        r = executeOrder(ctx, o);
      } catch (e) {
        r = { ok: false, result: { error: e instanceof Error ? e.message : 'Ошибка банка' } };
      }
      ctx.db.prepare('INSERT INTO gos_orders(id, type, fine_id, ok, result, created_at) VALUES(?,?,?,?,?,?)').run(o.id, o.type, o.fine_id, r.ok ? 1 : 0, JSON.stringify(r.result), ctx.now());
      done = { ok: r.ok ? 1 : 0, result: JSON.stringify(r.result) };
    }
    const result = safeJson<Record<string, unknown>>(done.result, {});
    if (o.type === 'collect' && done.ok && result.pay) {
      await gosRpc(ctx, 'svc_fine_paid', { p_id: o.fine_id, p_op: `order:${o.id}`, p_rub: o.amount_rub }).catch(() => {});
    }
    await gosRpc(ctx, 'svc_order_done', { p_id: o.id, p_ok: !!done.ok, p_result: result });
  }
  return orders.length;
}

/** Re-checks passports and roles of linked customers, a few per run (each at most once a day). */
export async function recheckPeople(ctx: Ctx, limit = 20) {
  if (!gosEnabled(ctx)) return;
  const rows = ctx.db.prepare('SELECT id FROM users WHERE gos_uid IS NOT NULL AND (gos_checked_at IS NULL OR gos_checked_at < ?) LIMIT ?').all(ctx.now() - 24 * 3600_000, limit) as { id: string }[];
  for (const r of rows) await refreshPerson(ctx, r.id).catch(() => ctx.db.prepare('UPDATE users SET gos_checked_at = ? WHERE id = ?').run(ctx.now(), r.id));
}

/** Who a Supabase access token belongs to (cached for a minute). Used by Бобуслуги pages calling the bank. */
const tokenCache = new Map<string, { uid: string; until: number }>();
export async function verifyGosToken(ctx: Ctx, token: string): Promise<string> {
  const hit = tokenCache.get(token);
  if (hit && hit.until > ctx.now()) return hit.uid;
  const key = ctx.cfg.supabaseAnonKey || ctx.cfg.supabaseServiceKey;
  let res: Response;
  try {
    res = await ctx.http(`${ctx.cfg.supabaseUrl}/auth/v1/user`, { method: 'GET', headers: { apikey: key, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new HttpError(502, 'Бобуслуги не отвечают');
  }
  if (!res.ok) throw new HttpError(401, 'Войдите на Бобуслугах заново');
  const u = (await res.json()) as { id?: string };
  if (!u.id) throw new HttpError(401, 'Войдите на Бобуслугах заново');
  if (tokenCache.size > 1000) tokenCache.clear();
  tokenCache.set(token, { uid: u.id, until: ctx.now() + 60_000 });
  return u.id;
}
