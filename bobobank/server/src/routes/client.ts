import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { audit, HttpError, type Ctx } from '../context.js';
import { decide, pendingConfirmations } from '../domain/acquiring.js';
import { pendingRequests } from '../domain/orders.js';
import { pendingPartnerRequests } from '../domain/partners.js';
import { BANK, CASHBACK_CATEGORIES, CATEGORIES, CORR_ACCOUNT, PREFIX, RESTRICTION_REASONS, RESTRICTION_TYPES, type Category } from '../domain/bank.js';
import { chooseCategories, chosenCategories, monthAccrued, RAISED_CATEGORIES, redeemBonus } from '../domain/bonus.js';
import { DESIGNS, issueCard, NETWORKS, ownedCard, revealCard, serializeCard, TARIFFS, type CardLimits, type CardRow } from '../domain/cards.js';
import {
  acceptOffer, apply, chargePrimeFee, closeInterestAccount, getApplication, getLoan, getProducts, openDeposit, openSavings, payInstalment, PRIME_FEE, repayLoan,
  type ApplicationRow, type LoanRow, type ScheduleItem,
} from '../domain/credit.js';
import { board, convertCustomer, exchange, getFx } from '../domain/fx.js';
import {
  activeRestrictions, available, getAccount, mainAccount, notify, openAccount, ownedAccount, serializeAccount, userAccounts, type AccountRow,
} from '../domain/ledger.js';
import { CURRENCIES, humanMoney, parseAmount } from '../domain/money.js';
import { gosEnabled, kycStatus, refreshPerson, requireKyc } from '../domain/gos.js';
import { formatPhone, getUser, normalizePhone, normalizeTransferPhone, resolveRecipient, telecomPhone, transfer, transferFee, type Recipient, type RecipientRef } from '../domain/transfers.js';
import { operationPdf, requisitesPdf, statementPdf } from '../pdf.js';
import { decrypt, newId, randomDigits, safeJson, sha256 } from '../util.js';

const currency = z.enum(CURRENCIES);
const amountSchema = z.union([z.string(), z.number()]).transform((v) => parseAmount(v));

export function restrictionView(ctx: Ctx, userId: string) {
  return activeRestrictions(ctx, userId).map((r) => ({
    id: r.id,
    type: r.type,
    typeTitle: RESTRICTION_TYPES[r.type],
    reason: r.reason,
    reasonTitle: RESTRICTION_REASONS[r.reason] ?? r.reason,
    comment: r.comment,
    amount: r.amount,
    accountId: r.account_id,
    createdAt: r.created_at,
  }));
}

export interface EntryRow {
  id: number;
  tx_id: string;
  account_id: string;
  amount: number;
  currency: string;
  balance_after: number;
  title: string;
  subtitle: string;
  category: Category;
  card_id: string | null;
  created_at: number;
  kind: string;
  meta: string;
  account_name: string;
  account_kind: string;
  card_last4: string | null;
  card_network: string | null;
}

/** In combined feeds a move between the customer's own accounts shows once: the debit side (the arrival for a closed deposit). */
export const FEED_FILTER = `NOT (t.kind IN ('own_transfer', 'deposit_open', 'fx') AND e.amount > 0) AND NOT (t.kind = 'deposit_close' AND e.amount < 0)`;

export const ENTRY_SELECT = `
  SELECT e.*, t.kind, t.meta, a.name account_name, a.kind account_kind, c.last4 card_last4, c.network card_network
  FROM entries e JOIN transactions t ON t.id = e.tx_id JOIN accounts a ON a.id = e.account_id LEFT JOIN cards c ON c.id = e.card_id`;

export function serializeEntry(e: EntryRow) {
  return {
    id: e.id,
    txId: e.tx_id,
    kind: e.kind,
    accountId: e.account_id,
    accountName: e.account_name,
    accountKind: e.account_kind,
    amount: e.amount,
    currency: e.currency,
    balanceAfter: e.balance_after,
    title: e.title,
    subtitle: e.subtitle,
    category: e.category,
    categoryTitle: CATEGORIES[e.category]?.title ?? 'Другое',
    card: e.card_last4 ? { last4: e.card_last4, network: e.card_network } : null,
    createdAt: e.created_at,
  };
}

function loanView(ctx: Ctx, l: LoanRow) {
  const schedule = safeJson<ScheduleItem[]>(l.schedule, []);
  const next = schedule.find((s) => !s.paid);
  const acc = getAccount(ctx, l.account_id)!;
  return {
    id: l.id,
    principal: l.principal,
    rate: l.rate,
    term: l.term,
    payment: l.payment,
    penalty: l.penalty,
    status: l.status,
    debt: -acc.balance,
    paidCount: schedule.filter((s) => s.paid).length,
    next: next ? { n: next.n, dueAt: next.dueAt, amount: next.payment + l.penalty } : null,
    schedule,
    payoutAccountId: l.payout_account_id,
    createdAt: l.created_at,
  };
}

function applicationView(a: ApplicationRow) {
  const f = safeJson<Record<string, unknown>>(a.factors, {});
  return {
    id: a.id,
    product: a.product,
    amount: a.amount,
    term: a.term,
    status: a.status,
    offerAmount: a.offer_amount,
    offerRate: a.offer_rate,
    reason: a.reason,
    network: f.network,
    createdAt: a.created_at,
    decidedAt: a.decided_at,
  };
}

function userCards(ctx: Ctx, userId: string) {
  return (ctx.db.prepare(`SELECT * FROM cards WHERE user_id = ? AND status != 'closed' ORDER BY created_at`).all(userId) as CardRow[]).map((c) => serializeCard(ctx, c));
}

function profile(ctx: Ctx, userId: string) {
  const u = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as { id: string; phone: string; name: string; birth_date: string; role: string; tariff: 'standard' | 'prime'; tariff_paid_until: number | null; bonus: number; created_at: number };
  return {
    id: u.id,
    phone: u.phone,
    phoneFormatted: formatPhone(u.phone),
    telecomPhone: (() => {
      const t = telecomPhone(ctx, u.id);
      return t ? formatPhone(t) : null;
    })(),
    name: u.name,
    birthDate: u.birth_date,
    role: u.role,
    tariff: u.tariff,
    tariffTitle: TARIFFS[u.tariff].title,
    tariffPaidUntil: u.tariff_paid_until,
    bonus: u.bonus,
    createdAt: u.created_at,
    gos: kycStatus(ctx, u.id),
  };
}

export function registerClientRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;
  const me = (req: FastifyRequest) => requireUser(req);

  // ---------- Home ----------
  app.get('/api/home', async (req) => {
    const u = me(req);
    const accounts = userAccounts(ctx, u.id).map((a) => serializeAccount(ctx, a));
    const recent = (db.prepare(`${ENTRY_SELECT} WHERE a.user_id = ? AND ${FEED_FILTER} ORDER BY e.id DESC LIMIT 8`).all(u.id) as EntryRow[]).map(serializeEntry);
    const unread = (db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read_at IS NULL').get(u.id) as { c: number }).c;
    const chatUnread = (db.prepare('SELECT COALESCE(SUM(unread_client), 0) c FROM support_threads WHERE user_id = ?').get(u.id) as { c: number }).c;
    const rub = accounts.filter((a) => a.currency === 'RUB' && ['current', 'savings', 'deposit', 'business', 'kids'].includes(a.kind)).reduce((s, a) => s + a.balance, 0);
    return {
      profile: profile(ctx, u.id),
      accounts,
      cards: userCards(ctx, u.id),
      recent,
      restrictions: restrictionView(ctx, u.id),
      confirmations: pendingConfirmations(ctx, u.id),
      unread,
      chatUnread,
      totalRub: rub,
      loans: (db.prepare(`SELECT * FROM loans WHERE user_id = ? AND status != 'closed'`).all(u.id) as LoanRow[]).map((l) => loanView(ctx, l)),
      applications: (db.prepare(`SELECT * FROM applications WHERE user_id = ? AND status IN ('processing', 'review', 'approved') ORDER BY created_at DESC`).all(u.id) as ApplicationRow[]).map(applicationView),
    };
  });

  app.get('/api/profile', async (req) => ({ profile: profile(ctx, me(req).id) }));

  // ---------- Accounts ----------
  app.get('/api/accounts/:id', async (req) => {
    const u = me(req);
    const acc = ownedAccount(ctx, u.id, (req.params as { id: string }).id);
    const entries = (db.prepare(`${ENTRY_SELECT} WHERE e.account_id = ? ORDER BY e.id DESC LIMIT 50`).all(acc.id) as EntryRow[]).map(serializeEntry);
    const cards = (db.prepare(`SELECT * FROM cards WHERE account_id = ? AND status != 'closed'`).all(acc.id) as CardRow[]).map((c) => serializeCard(ctx, c));
    const links = acc.kind === 'business' ? db.prepare('SELECT shop_id shopId, shop_name shopName, used_at usedAt FROM gpay_links WHERE account_id = ? AND used_at IS NOT NULL ORDER BY used_at DESC').all(acc.id) : [];
    return {
      account: serializeAccount(ctx, acc),
      entries,
      cards,
      gpayLinks: links,
      requisites: { holder: getUser(ctx, u.id)!.name, number: acc.number, bank: BANK.legalName, bik: BANK.bik, corr: CORR_ACCOUNT, inn: BANK.inn, kpp: BANK.kpp },
    };
  });

  const openBody = z.object({
    kind: z.enum(['current', 'savings', 'business']),
    currency: currency.default('RUB'),
    businessType: z.enum(['ip', 'ooo']).optional(),
    legalName: z.string().trim().min(3).max(120).optional(),
    inn: z.string().regex(/^\d{10}$|^\d{12}$/, 'ИНН — 10 или 12 цифр').optional(),
    businessId: z.number().int().optional(),
  });
  app.post('/api/accounts', async (req) => {
    const u = me(req);
    const b = openBody.parse(req.body);
    requireKyc(ctx, u.id);
    if (userAccounts(ctx, u.id).length >= 20) throw new HttpError(400, 'Слишком много открытых счетов');
    let acc: AccountRow;
    if (b.kind === 'business' && gosEnabled(ctx)) {
      // The business comes from the state registry on Бобуслуги: name and INN cannot be typed in.
      if (!b.businessId) throw new HttpError(400, 'Выберите бизнес из реестра Бобуслуг');
      const person = await refreshPerson(ctx, u.id);
      const biz = person?.businesses.find((x) => x.id === b.businessId);
      if (!biz) throw new HttpError(404, 'Бизнес не найден в реестре Бобуслуг');
      b.businessType = biz.org_type === 'ИП' ? 'ip' : 'ooo';
      b.legalName = biz.name;
      b.inn = biz.inn;
    }
    if (b.kind === 'savings') acc = openSavings(ctx, u.id, b.currency);
    else if (b.kind === 'business') {
      if (!b.legalName || !b.inn || !b.businessType) throw new HttpError(400, 'Укажите название и ИНН организации');
      const ip = b.businessType === 'ip';
      if (ip !== (b.inn.length === 12)) throw new HttpError(400, ip ? 'ИНН ИП — 12 цифр' : 'ИНН ООО — 10 цифр');
      acc = openAccount(ctx, u.id, 'business', b.currency, ip ? `ИП ${b.legalName}` : `ООО «${b.legalName}»`, {
        prefix: ip ? PREFIX.business_ip : PREFIX.business_ooo,
        params: { type: b.businessType, legalName: b.legalName, inn: b.inn, gosBusinessId: b.businessId },
      });
    } else acc = openAccount(ctx, u.id, 'current', b.currency, b.currency === 'RUB' ? 'Платёжный счёт' : `Счёт в ${b.currency === 'USD' ? 'долларах' : 'евро'}`);
    audit(ctx, req, 'account_open', 'account', acc.id, `${b.kind} ${b.currency}`);
    return { account: serializeAccount(ctx, acc) };
  });

  app.post('/api/accounts/:id/rename', async (req) => {
    const u = me(req);
    const acc = ownedAccount(ctx, u.id, (req.params as { id: string }).id);
    const { name } = z.object({ name: z.string().trim().min(1).max(40) }).parse(req.body);
    db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(name, acc.id);
    return { ok: true };
  });

  app.post('/api/accounts/:id/close', async (req) => {
    const u = me(req);
    const acc = ownedAccount(ctx, u.id, (req.params as { id: string }).id);
    const { toAccountId } = z.object({ toAccountId: z.string().optional() }).parse(req.body ?? {});
    if (acc.status !== 'open') throw new HttpError(400, 'Счёт уже закрыт');
    if (acc.kind === 'loan' || acc.kind === 'credit_card') throw new HttpError(400, 'Кредитный счёт закрывается после погашения');
    if (acc.kind === 'deposit' || acc.kind === 'savings') {
      const to = toAccountId ? ownedAccount(ctx, u.id, toAccountId) : mainAccount(ctx, u.id);
      if (!to || to.id === acc.id) throw new HttpError(400, 'Выберите счёт для перевода остатка');
      if (to.currency !== acc.currency) throw new HttpError(400, 'Счёт для остатка должен быть в той же валюте');
      const r = closeInterestAccount(ctx, u.id, acc, to);
      return { ok: true, forfeit: r.forfeit };
    }
    if (acc.balance !== 0) throw new HttpError(400, 'Переведите остаток с счёта перед закрытием');
    if (db.prepare(`SELECT 1 FROM cards WHERE account_id = ? AND status != 'closed'`).get(acc.id)) throw new HttpError(400, 'Сначала закройте карты этого счёта');
    if (mainAccount(ctx, u.id)?.id === acc.id && userAccounts(ctx, u.id).filter((a) => a.kind === 'current' && a.currency === 'RUB').length === 1) throw new HttpError(400, 'Основной рублёвый счёт закрыть нельзя');
    db.prepare(`UPDATE accounts SET status = 'closed', closed_at = ? WHERE id = ?`).run(ctx.now(), acc.id);
    return { ok: true };
  });

  app.get('/api/accounts/:id/requisites.pdf', async (req, reply) => {
    const u = me(req);
    const acc = ownedAccount(ctx, u.id, (req.params as { id: string }).id);
    const prm = safeJson<{ legalName?: string; inn?: string; type?: string }>(acc.params, {});
    const holder = acc.kind === 'business' ? acc.name : getUser(ctx, u.id)!.name;
    const pdf = await requisitesPdf({ holder, number: acc.number, currency: acc.currency, accountName: acc.name, inn: prm.inn });
    return reply.type('application/pdf').header('content-disposition', `inline; filename="requisites-${acc.number}.pdf"`).send(pdf);
  });

  app.get('/api/accounts/:id/statement.pdf', async (req, reply) => {
    const u = me(req);
    const acc = ownedAccount(ctx, u.id, (req.params as { id: string }).id);
    const q = z.object({ from: z.coerce.number().optional(), to: z.coerce.number().optional() }).parse(req.query);
    const to = q.to ?? ctx.now();
    const from = q.from ?? to - 30 * 24 * 3600_000;
    const lines = db.prepare('SELECT * FROM entries WHERE account_id = ? AND created_at >= ? AND created_at <= ? ORDER BY id').all(acc.id, from, to) as EntryRow[];
    const before = db.prepare('SELECT balance_after FROM entries WHERE account_id = ? AND created_at < ? ORDER BY id DESC LIMIT 1').get(acc.id, from) as { balance_after: number } | undefined;
    const opening = before?.balance_after ?? 0;
    const closing = lines.length ? lines[lines.length - 1].balance_after : opening;
    const pdf = await statementPdf({ holder: getUser(ctx, u.id)!.name, accountName: acc.name, number: acc.number, currency: acc.currency, from, to, opening, closing, lines: lines.map((l) => ({ ts: l.created_at, title: l.title, subtitle: l.subtitle, amount: l.amount })) });
    return reply.type('application/pdf').header('content-disposition', `inline; filename="statement-${acc.number}.pdf"`).send(pdf);
  });

  // ---------- Cards ----------
  const issueBody = z.object({
    network: z.enum(NETWORKS),
    form: z.enum(['plastic', 'virtual']),
    tariff: z.enum(['standard', 'prime', 'kids']),
    design: z.enum(Object.keys(DESIGNS) as [keyof typeof DESIGNS, ...(keyof typeof DESIGNS)[]]),
    accountId: z.string().optional(),
    childName: z.string().trim().min(3).max(60).optional(),
  });
  app.post('/api/cards', async (req) => {
    const u = me(req);
    const b = issueBody.parse(req.body);
    requireKyc(ctx, u.id);
    const user = getUser(ctx, u.id)!;
    if ((db.prepare(`SELECT COUNT(*) c FROM cards WHERE user_id = ? AND status != 'closed'`).get(u.id) as { c: number }).c >= 10) throw new HttpError(400, 'Можно держать до 10 карт');
    if (b.tariff === 'prime' && user.tariff !== 'prime') throw new HttpError(400, 'Карта Prime доступна с подпиской Bobo Prime');
    let acc: AccountRow;
    let holder = user.name;
    if (b.tariff === 'kids') {
      if (!b.childName) throw new HttpError(400, 'Укажите имя ребёнка');
      holder = b.childName;
      acc = openAccount(ctx, u.id, 'kids', 'RUB', `Детская карта: ${b.childName.split(' ')[0]}`);
    } else {
      acc = b.accountId ? ownedAccount(ctx, u.id, b.accountId) : mainAccount(ctx, u.id)!;
      if (!acc || !['current', 'business'].includes(acc.kind) || acc.status !== 'open') throw new HttpError(400, 'Карту можно выпустить к платёжному или бизнес-счёту');
    }
    const card = issueCard(ctx, { userId: u.id, account: acc, network: b.network, kind: 'debit', form: b.form, tariff: b.tariff, design: b.design, holder });
    audit(ctx, req, 'card_issue', 'card', card.id, `${b.network} ${b.tariff}`);
    notify(ctx, u.id, 'card', `${b.form === 'virtual' ? 'Виртуальная карта' : 'Карта'} •• ${card.last4} готова`, b.form === 'virtual' ? 'Ей уже можно платить в интернете.' : 'Пластиковую карту доставим за 3 дня, а пока платите её цифровой версией.');
    return { card: serializeCard(ctx, card) };
  });

  app.get('/api/cards/:id', async (req) => {
    const u = me(req);
    const c = ownedCard(ctx, u.id, (req.params as { id: string }).id);
    const acc = getAccount(ctx, c.account_id)!;
    const entries = (db.prepare(`${ENTRY_SELECT} WHERE e.card_id = ? ORDER BY e.id DESC LIMIT 30`).all(c.id) as EntryRow[]).map(serializeEntry);
    return { card: serializeCard(ctx, c), account: serializeAccount(ctx, acc), entries };
  });

  app.post('/api/cards/:id/reveal', async (req) => {
    const u = me(req);
    const c = ownedCard(ctx, u.id, (req.params as { id: string }).id);
    if (c.status === 'closed') throw new HttpError(400, 'Карта закрыта');
    audit(ctx, req, 'card_reveal', 'card', c.id);
    return revealCard(ctx, c);
  });

  app.post('/api/cards/:id/freeze', async (req) => {
    const u = me(req);
    const c = ownedCard(ctx, u.id, (req.params as { id: string }).id);
    const { frozen } = z.object({ frozen: z.boolean() }).parse(req.body);
    if (c.status === 'blocked') throw new HttpError(403, `Карта заблокирована банком${c.status_reason ? `: ${c.status_reason}` : ''}`);
    if (c.status === 'closed') throw new HttpError(400, 'Карта закрыта');
    db.prepare('UPDATE cards SET status = ? WHERE id = ?').run(frozen ? 'frozen' : 'active', c.id);
    return { card: serializeCard(ctx, ownedCard(ctx, u.id, c.id)) };
  });

  app.post('/api/cards/:id/settings', async (req) => {
    const u = me(req);
    const c = ownedCard(ctx, u.id, (req.params as { id: string }).id);
    const b = z.object({ monthly: z.number().int().min(0).max(100_000_000_00).optional(), online: z.boolean().optional(), confirmPurchases: z.boolean().optional() }).parse(req.body);
    const limits = { ...safeJson<CardLimits>(c.limits, { monthly: 0, online: true }) };
    if (b.monthly !== undefined) limits.monthly = b.monthly;
    if (b.online !== undefined) limits.online = b.online;
    db.prepare('UPDATE cards SET limits = ?, confirm_purchases = ? WHERE id = ?').run(JSON.stringify(limits), b.confirmPurchases === undefined ? c.confirm_purchases : b.confirmPurchases ? 1 : 0, c.id);
    return { card: serializeCard(ctx, ownedCard(ctx, u.id, c.id)) };
  });

  app.post('/api/cards/:id/reissue', async (req) => {
    const u = me(req);
    const c = ownedCard(ctx, u.id, (req.params as { id: string }).id);
    if (c.status === 'closed') throw new HttpError(400, 'Карта уже закрыта');
    if (c.status === 'blocked') throw new HttpError(403, 'Перевыпуск заблокированной карты — через поддержку');
    const acc = getAccount(ctx, c.account_id)!;
    const fresh = issueCard(ctx, { userId: u.id, account: acc, network: c.network, kind: c.kind, form: c.form, tariff: c.tariff, design: c.design, holder: c.holder });
    db.prepare(`UPDATE cards SET status = 'closed', status_reason = 'Перевыпущена' WHERE id = ?`).run(c.id);
    db.prepare('UPDATE cards SET limits = ?, confirm_purchases = ? WHERE id = ?').run(c.limits, c.confirm_purchases, fresh.id);
    audit(ctx, req, 'card_reissue', 'card', c.id, fresh.id);
    return { card: serializeCard(ctx, fresh) };
  });

  app.post('/api/cards/:id/close', async (req) => {
    const u = me(req);
    const c = ownedCard(ctx, u.id, (req.params as { id: string }).id);
    if (c.kind === 'credit') {
      const acc = getAccount(ctx, c.account_id)!;
      if (acc.balance < 0) throw new HttpError(400, `Сначала погасите задолженность ${humanMoney(-acc.balance, 'RUB')}`);
      db.prepare(`UPDATE accounts SET status = 'closed', closed_at = ?, credit_limit = 0 WHERE id = ?`).run(ctx.now(), acc.id);
    }
    db.prepare(`UPDATE cards SET status = 'closed', status_reason = 'Закрыта клиентом' WHERE id = ?`).run(c.id);
    return { ok: true };
  });

  // ---------- History & analytics ----------
  app.get('/api/history', async (req) => {
    const u = me(req);
    const q = z.object({ account: z.string().optional(), category: z.string().optional(), q: z.string().max(60).optional(), before: z.coerce.number().optional(), dir: z.enum(['in', 'out']).optional() }).parse(req.query);
    const where = ['a.user_id = ?'];
    const args: unknown[] = [u.id];
    if (q.account) (where.push('e.account_id = ?'), args.push(q.account));
    else where.push(FEED_FILTER);
    if (q.category) (where.push('e.category = ?'), args.push(q.category));
    if (q.q) (where.push('(e.title LIKE ? OR e.subtitle LIKE ?)'), args.push(`%${q.q}%`, `%${q.q}%`));
    if (q.before) (where.push('e.id < ?'), args.push(q.before));
    if (q.dir === 'in') where.push('e.amount > 0');
    if (q.dir === 'out') where.push('e.amount < 0');
    const rows = db.prepare(`${ENTRY_SELECT} WHERE ${where.join(' AND ')} ORDER BY e.id DESC LIMIT 41`).all(...args) as EntryRow[];
    const holds = db
      .prepare(`SELECT h.*, a.currency, c.last4 FROM holds h JOIN accounts a ON a.id = h.account_id LEFT JOIN cards c ON c.id = h.card_id WHERE a.user_id = ? AND h.status = 'active' ORDER BY h.created_at DESC`)
      .all(u.id) as { id: string; amount: number; currency: string; title: string; category: Category; created_at: number; last4: string | null }[];
    return {
      items: rows.slice(0, 40).map(serializeEntry),
      next: rows.length > 40 ? rows[39].id : null,
      pending: q.before ? [] : holds.map((h) => ({ id: h.id, amount: -h.amount, currency: h.currency, title: h.title, subtitle: `Ожидает списания${h.last4 ? ` · карта •• ${h.last4}` : ''}`, category: h.category, createdAt: h.created_at })),
    };
  });

  app.get('/api/history/:id', async (req) => {
    const u = me(req);
    const e = db.prepare(`${ENTRY_SELECT} WHERE e.id = ? AND a.user_id = ?`).get(Number((req.params as { id: string }).id), u.id) as EntryRow | undefined;
    if (!e) throw new HttpError(404, 'Операция не найдена');
    const meta = safeJson<Record<string, unknown>>(e.meta, {});
    const acc = getAccount(ctx, e.account_id)!;
    return { entry: serializeEntry(e), meta, account: { number: acc.number, name: acc.name } };
  });

  app.get('/api/history/:id/receipt.pdf', async (req, reply) => {
    const u = me(req);
    const e = db.prepare(`${ENTRY_SELECT} WHERE e.id = ? AND a.user_id = ?`).get(Number((req.params as { id: string }).id), u.id) as EntryRow | undefined;
    if (!e) throw new HttpError(404, 'Операция не найдена');
    const acc = getAccount(ctx, e.account_id)!;
    const meta = safeJson<{ fee?: number; comment?: string; to?: string; merchant?: { name: string; inn?: string } }>(e.meta, {});
    const KIND: Record<string, string> = {
      transfer: 'Перевод клиенту', own_transfer: 'Перевод между своими счетами', purchase: 'Оплата покупки', refund: 'Возврат покупки', fx: 'Обмен валюты', sbp_payment: 'Оплата по QR-коду СБП',
      gpay_payout: 'Зачисление выручки', loan_issue: 'Выдача кредита', loan_payment: 'Платёж по кредиту', loan_repay: 'Погашение кредита', interest: 'Начисление процентов', admin_credit: 'Зачисление', admin_debit: 'Списание', deposit_open: 'Открытие вклада', deposit_close: 'Закрытие вклада', bonus_redeem: 'Обмен бонусов', fee: 'Комиссия',
    };
    const rows: [string, string][] = [
      [e.amount < 0 ? 'Счёт списания' : 'Счёт зачисления', `${acc.name} •• ${acc.number.slice(-4)}`],
      ...(e.card_last4 ? [['Карта', `•• ${e.card_last4}`] as [string, string]] : []),
      ...(e.subtitle ? [['Детали', e.subtitle] as [string, string]] : []),
      ...(meta.merchant?.inn ? [['ИНН получателя', meta.merchant.inn] as [string, string]] : []),
      ['Статус', 'Выполнено'],
    ];
    const pdf = await operationPdf({ id: e.tx_id, createdAt: e.created_at, kind: KIND[e.kind] ?? 'Операция', title: e.title, amount: Math.abs(e.amount), currency: e.currency, fee: e.amount < 0 ? meta.fee ?? 0 : 0, rows });
    return reply.type('application/pdf').header('content-disposition', `inline; filename="receipt-${e.tx_id}.pdf"`).send(pdf);
  });

  app.get('/api/analytics', async (req) => {
    const u = me(req);
    const q = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(req.query);
    const now = new Date(ctx.now());
    const [y, m] = (q.month ?? now.toISOString().slice(0, 7)).split('-').map(Number);
    const from = Date.UTC(y, m - 1, 1);
    const to = Date.UTC(y, m, 1);
    const spendCats = Object.keys(CATEGORIES).filter((c) => !['transfers', 'income', 'credit', 'savings', 'fx', 'bonus'].includes(c));
    const ph = spendCats.map(() => '?').join(',');
    const byCat = db
      .prepare(
        `SELECT e.category, -SUM(e.amount) total, COUNT(*) n FROM entries e JOIN accounts a ON a.id = e.account_id
         WHERE a.user_id = ? AND e.currency = 'RUB' AND e.created_at >= ? AND e.created_at < ? AND e.category IN (${ph}) GROUP BY e.category HAVING total > 0 ORDER BY total DESC`,
      )
      .all(u.id, from, to, ...spendCats) as { category: Category; total: number; n: number }[];
    const transfers = db
      .prepare(`SELECT -COALESCE(SUM(e.amount), 0) s FROM entries e JOIN accounts a ON a.id = e.account_id JOIN transactions t ON t.id = e.tx_id WHERE a.user_id = ? AND e.currency = 'RUB' AND e.amount < 0 AND t.kind = 'transfer' AND e.created_at >= ? AND e.created_at < ?`)
      .get(u.id, from, to) as { s: number };
    const income = db
      .prepare(`SELECT COALESCE(SUM(e.amount), 0) s FROM entries e JOIN accounts a ON a.id = e.account_id WHERE a.user_id = ? AND e.currency = 'RUB' AND e.amount > 0 AND e.category IN ('income', 'credit') AND e.created_at >= ? AND e.created_at < ?`)
      .get(u.id, from, to) as { s: number };
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const s = Date.UTC(y, m - 1 - i, 1);
      const e = Date.UTC(y, m - i, 1);
      const r = db
        .prepare(`SELECT -COALESCE(SUM(e.amount), 0) s FROM entries e JOIN accounts a ON a.id = e.account_id WHERE a.user_id = ? AND e.currency = 'RUB' AND e.created_at >= ? AND e.created_at < ? AND e.category IN (${ph})`)
        .get(u.id, s, e, ...spendCats) as { s: number };
      months.push({ month: new Date(s).toISOString().slice(0, 7), total: Math.max(0, r.s) });
    }
    const bonus = db.prepare('SELECT COALESCE(SUM(amount), 0) s FROM bonus_log WHERE user_id = ? AND amount > 0 AND created_at >= ? AND created_at < ?').get(u.id, from, to) as { s: number };
    return {
      month: `${y}-${String(m).padStart(2, '0')}`,
      spent: byCat.reduce((s, c) => s + c.total, 0),
      transfers: transfers.s,
      income: income.s,
      bonus: bonus.s,
      categories: byCat.map((c) => ({ ...c, title: CATEGORIES[c.category]?.title ?? c.category })),
      months,
    };
  });

  // ---------- Transfers ----------
  const recipient = z.discriminatedUnion('type', [
    z.object({ type: z.literal('phone'), phone: z.string().min(5).max(30) }),
    z.object({ type: z.literal('card'), pan: z.string().min(12).max(30) }),
    z.object({ type: z.literal('account'), number: z.string().min(20).max(30), bik: z.string(), name: z.string().trim().min(2).max(120), inn: z.string().optional(), purpose: z.string().max(210).optional() }),
    z.object({ type: z.literal('own'), accountId: z.string() }),
    z.object({ type: z.literal('card_id'), cardId: z.string() }),
  ]);

  const resolve = (userId: string, r: z.infer<typeof recipient>, cur: string) => {
    if (r.type === 'own') {
      const acc = ownedAccount(ctx, userId, r.accountId);
      if (acc.status !== 'open') throw new HttpError(400, 'Счёт закрыт');
      if (acc.kind === 'deposit') throw new HttpError(400, 'Вклад не пополняется — откройте новый вклад');
      return { account: acc, user: getUser(ctx, userId)!, display: acc.name, subtitle: `На счёт •• ${acc.number.slice(-4)}` };
    }
    if (r.type === 'card_id') {
      // Saved card recipient: the number itself is never sent back to the client.
      const c = db.prepare(`SELECT pan_enc FROM cards WHERE id = ? AND status != 'closed'`).get(r.cardId) as { pan_enc: string } | undefined;
      if (!c) throw new HttpError(404, 'Карта получателя закрыта или не найдена');
      return resolveRecipient(ctx, { type: 'card', pan: decrypt(ctx.secret, c.pan_enc) }, cur);
    }
    return resolveRecipient(ctx, r as Recipient, cur);
  };

  app.post('/api/transfers/quote', async (req) => {
    const u = me(req);
    const b = z.object({ fromAccountId: z.string(), recipient, amount: amountSchema.optional() }).parse(req.body);
    const from = ownedAccount(ctx, u.id, b.fromAccountId);
    const to = resolve(u.id, b.recipient, from.currency);
    const own = to.user?.id === u.id;
    const fee = b.amount && !own ? transferFee(ctx, getUser(ctx, u.id)!, b.amount, from.currency) : 0;
    const credited = b.amount && to.account && to.account.currency !== from.currency ? convertCustomer(getFx(db), b.amount, from.currency, to.account.currency) : null;
    return {
      display: to.display,
      subtitle: to.subtitle,
      bank: to.account ? 'Bobobank' : 'Другой банк',
      own,
      fee,
      available: available(ctx, from),
      credited: credited ? { amount: credited.result, currency: to.account!.currency, rate: credited.rate } : null,
    };
  });

  app.post('/api/transfers', async (req) => {
    const u = me(req);
    const b = z.object({ fromAccountId: z.string(), recipient, amount: amountSchema, comment: z.string().trim().max(140).optional() }).parse(req.body);
    const from = ownedAccount(ctx, u.id, b.fromAccountId);
    if (from.kind === 'deposit') throw new HttpError(400, 'С вклада нельзя переводить — закройте его');
    if (from.kind === 'loan') throw new HttpError(400, 'Это кредитный счёт');
    const to = resolve(u.id, b.recipient, from.currency);
    const r = transfer(ctx, getUser(ctx, u.id)!, from, to, b.amount, b.comment ?? '');
    audit(ctx, req, 'transfer', 'transaction', r.txId, `${humanMoney(b.amount, from.currency)} → ${to.display}`);
    const entry = db.prepare('SELECT id FROM entries WHERE tx_id = ? AND account_id = ?').get(r.txId, from.id) as { id: number };
    return { txId: r.txId, entryId: entry.id, fee: r.fee, to: to.display };
  });

  /** Recent people the customer sent money to: from the recipient stored with each transfer. */
  app.get('/api/transfers/recent', async (req) => {
    const u = me(req);
    const rows = db
      .prepare(
        `SELECT e.title, e.subtitle, t.meta, e.created_at ts FROM entries e JOIN accounts a ON a.id = e.account_id JOIN transactions t ON t.id = e.tx_id
         WHERE a.user_id = ? AND t.kind = 'transfer' AND e.amount < 0 ORDER BY e.id DESC LIMIT 100`,
      )
      .all(u.id) as { title: string; subtitle: string; meta: string; ts: number }[];
    const seen = new Set<string>();
    const items: { name: string; subtitle: string; type: string; phone: string | null; cardId: string | null; number: string | null; bik: string | null }[] = [];
    for (const r of rows) {
      const rec = safeJson<{ recipient?: RecipientRef }>(r.meta, {}).recipient;
      // Transfers made before recipients were stored: the phone may still be in the subtitle.
      const legacyPhone = /\+7 [\d -]{13}/.exec(r.subtitle)?.[0]?.replace(/\D/g, '') ?? null;
      const ref: RecipientRef = rec ?? { type: legacyPhone ? 'phone' : 'account', name: r.title, phone: legacyPhone ?? undefined };
      if (ref.type === 'account' && !ref.number) continue;
      const key = `${ref.type}:${ref.phone ?? ref.cardId ?? ref.number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        name: ref.name,
        subtitle: ref.type === 'phone' ? formatPhone(ref.phone!) : ref.type === 'card' ? `Карта •• ${ref.last4}` : `Счёт •• ${ref.number!.slice(-4)}`,
        type: ref.type,
        phone: ref.phone ?? null,
        cardId: ref.cardId ?? null,
        number: ref.number ?? null,
        bik: ref.bik ?? null,
      });
      if (items.length >= 10) break;
    }
    return { items };
  });

  // ---------- Favourites ----------
  const favView = (f: { id: string; title: string; type: string; value: string; bik: string | null; amount: number | null; created_at: number }) => ({
    id: f.id,
    title: f.title,
    type: f.type,
    value: f.value,
    bik: f.bik,
    amount: f.amount,
    subtitle: f.type === 'phone' ? formatPhone(f.value) : f.type === 'card' ? `Карта •• ${String(db.prepare('SELECT last4 FROM cards WHERE id = ?').pluck().get(f.value) ?? '')}` : `Счёт •• ${f.value.slice(-4)}`,
  });

  app.get('/api/favorites', async (req) => {
    const rows = db.prepare('SELECT * FROM favorites WHERE user_id = ? ORDER BY created_at').all(me(req).id) as Parameters<typeof favView>[0][];
    return { items: rows.map(favView) };
  });

  app.post('/api/favorites', async (req) => {
    const u = me(req);
    const b = z
      .object({ title: z.string().trim().min(1).max(40), type: z.enum(['phone', 'card', 'account']), value: z.string().min(1).max(30), bik: z.string().regex(/^\d{9}$/).optional(), amount: amountSchema.optional() })
      .parse(req.body);
    if ((db.prepare('SELECT COUNT(*) c FROM favorites WHERE user_id = ?').get(u.id) as { c: number }).c >= 30) throw new HttpError(400, 'В избранном не больше 30 получателей');
    const value = b.type === 'phone' ? normalizeTransferPhone(b.value) : b.value.replace(/\s/g, '');
    if (!value) throw new HttpError(400, 'Некорректный номер телефона');
    if (b.type === 'card' && !db.prepare(`SELECT 1 FROM cards WHERE id = ? AND status != 'closed'`).get(value)) throw new HttpError(400, 'Карта получателя не найдена');
    const dup = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND type = ? AND value = ?').get(u.id, b.type, value) as { id: string } | undefined;
    if (dup) {
      db.prepare('UPDATE favorites SET title = ?, amount = ? WHERE id = ?').run(b.title, b.amount ?? null, dup.id);
      return { favorite: favView(db.prepare('SELECT * FROM favorites WHERE id = ?').get(dup.id) as Parameters<typeof favView>[0]) };
    }
    const id = newId('fav', 12);
    db.prepare('INSERT INTO favorites(id, user_id, title, type, value, bik, amount, created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, u.id, b.title, b.type, value, b.bik ?? null, b.amount ?? null, ctx.now());
    return { favorite: favView(db.prepare('SELECT * FROM favorites WHERE id = ?').get(id) as Parameters<typeof favView>[0]) };
  });

  app.delete('/api/favorites/:id', async (req) => {
    const r = db.prepare('DELETE FROM favorites WHERE id = ? AND user_id = ?').run((req.params as { id: string }).id, me(req).id);
    if (!r.changes) throw new HttpError(404, 'Не найдено');
    return { ok: true };
  });

  // ---------- FX ----------
  app.get('/api/fx', async () => {
    const fx = getFx(db);
    return { board: board(fx), updatedAt: fx.updatedAt };
  });

  app.post('/api/fx/quote', async (req) => {
    const u = me(req);
    const b = z.object({ fromAccountId: z.string(), toAccountId: z.string(), amount: amountSchema }).parse(req.body);
    const from = ownedAccount(ctx, u.id, b.fromAccountId);
    const to = ownedAccount(ctx, u.id, b.toAccountId);
    const r = convertCustomer(getFx(db), b.amount, from.currency, to.currency);
    return { result: r.result, rate: r.rate, from: from.currency, to: to.currency };
  });

  app.post('/api/fx/exchange', async (req) => {
    const u = me(req);
    const b = z.object({ fromAccountId: z.string(), toAccountId: z.string(), amount: amountSchema }).parse(req.body);
    const r = exchange(ctx, u.id, ownedAccount(ctx, u.id, b.fromAccountId), ownedAccount(ctx, u.id, b.toAccountId), b.amount);
    audit(ctx, req, 'fx', 'transaction', r.txId);
    return r;
  });

  // ---------- Bonuses & tariff ----------
  app.get('/api/bonus', async (req) => {
    const u = me(req);
    const row = db.prepare('SELECT bonus, tariff, cashback FROM users WHERE id = ?').get(u.id) as { bonus: number; tariff: 'standard' | 'prime'; cashback: string };
    const t = TARIFFS[row.tariff];
    return {
      balance: row.bonus,
      tariff: row.tariff,
      base: t.cashbackBase,
      raised: t.cashbackRaised,
      cap: t.cashbackCap,
      accruedThisMonth: monthAccrued(ctx, u.id, ctx.now()),
      chosen: chosenCategories(row.cashback, ctx.now()),
      pick: RAISED_CATEGORIES,
      categories: CASHBACK_CATEGORIES.map((c) => ({ id: c, title: CATEGORIES[c].title })),
      log: db.prepare('SELECT id, amount, title, category, created_at createdAt FROM bonus_log WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(u.id),
    };
  });

  app.post('/api/bonus/categories', async (req) => {
    const u = me(req);
    const { categories } = z.object({ categories: z.array(z.string()) }).parse(req.body);
    return { chosen: chooseCategories(ctx, u.id, categories) };
  });

  app.post('/api/bonus/redeem', async (req) => {
    const u = me(req);
    const { amount } = z.object({ amount: amountSchema }).parse(req.body);
    redeemBonus(ctx, u.id, amount);
    return { ok: true };
  });

  app.post('/api/tariff', async (req) => {
    const u = me(req);
    const { tariff } = z.object({ tariff: z.enum(['standard', 'prime']) }).parse(req.body);
    const cur = getUser(ctx, u.id)!;
    if (tariff === cur.tariff) return { profile: profile(ctx, u.id) };
    if (tariff === 'prime') {
      if (!chargePrimeFee(ctx, u.id)) throw new HttpError(400, `Для подключения нужно ${humanMoney(PRIME_FEE, 'RUB')} на основном счёте`);
      notify(ctx, u.id, 'tariff', 'Bobo Prime подключён', 'Повышенный кешбэк и бесплатные переводы уже работают.');
    } else {
      db.prepare(`UPDATE users SET tariff = 'standard', tariff_paid_until = NULL WHERE id = ?`).run(u.id);
    }
    audit(ctx, req, 'tariff', 'user', u.id, tariff);
    return { profile: profile(ctx, u.id) };
  });

  // ---------- Savings, deposits, credits ----------
  app.get('/api/products', async () => {
    const p = getProducts(db);
    return { products: p, tariffs: TARIFFS, primeFee: PRIME_FEE, designs: DESIGNS };
  });

  app.post('/api/deposits', async (req) => {
    const u = me(req);
    const b = z.object({ fromAccountId: z.string(), amount: amountSchema, months: z.number().int() }).parse(req.body);
    requireKyc(ctx, u.id);
    const dep = openDeposit(ctx, u.id, ownedAccount(ctx, u.id, b.fromAccountId), b.amount, b.months);
    audit(ctx, req, 'deposit_open', 'account', dep.id);
    return { account: serializeAccount(ctx, dep) };
  });

  app.get('/api/credits', async (req) => {
    const u = me(req);
    const loans = (db.prepare(`SELECT * FROM loans WHERE user_id = ? ORDER BY created_at DESC`).all(u.id) as LoanRow[]).map((l) => loanView(ctx, l));
    const apps = (db.prepare(`SELECT * FROM applications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`).all(u.id) as ApplicationRow[]).map(applicationView);
    const creditCards = userAccounts(ctx, u.id).filter((a) => a.kind === 'credit_card').map((a) => serializeAccount(ctx, a));
    return { loans, applications: apps, creditCards, products: getProducts(db) };
  });

  app.post('/api/applications', async (req) => {
    const u = me(req);
    const b = z.object({ product: z.enum(['loan', 'credit_card']), amount: amountSchema, term: z.number().int().default(0), network: z.enum(NETWORKS).optional(), design: z.enum(Object.keys(DESIGNS) as [keyof typeof DESIGNS]).optional() }).parse(req.body);
    requireKyc(ctx, u.id);
    const a = apply(ctx, u.id, b.product, b.amount, b.term, { network: b.network, design: b.design });
    audit(ctx, req, 'credit_apply', 'application', a.id, `${b.product} ${humanMoney(b.amount, 'RUB')}`);
    return { application: applicationView(a) };
  });

  app.get('/api/applications/:id', async (req) => {
    const u = me(req);
    const a = getApplication(ctx, (req.params as { id: string }).id);
    if (!a || a.user_id !== u.id) throw new HttpError(404, 'Заявка не найдена');
    return { application: applicationView(a) };
  });

  app.post('/api/applications/:id/accept', async (req) => {
    const u = me(req);
    const a = getApplication(ctx, (req.params as { id: string }).id);
    if (!a) throw new HttpError(404, 'Заявка не найдена');
    const resultId = acceptOffer(ctx, u.id, a);
    audit(ctx, req, 'credit_accept', 'application', a.id, resultId);
    return { resultId, product: a.product };
  });

  app.post('/api/applications/:id/cancel', async (req) => {
    const u = me(req);
    const a = getApplication(ctx, (req.params as { id: string }).id);
    if (!a || a.user_id !== u.id) throw new HttpError(404, 'Заявка не найдена');
    if (!['processing', 'review', 'approved'].includes(a.status)) throw new HttpError(400, 'Заявку уже нельзя отменить');
    db.prepare(`UPDATE applications SET status = 'canceled' WHERE id = ?`).run(a.id);
    return { ok: true };
  });

  app.post('/api/loans/:id/pay', async (req) => {
    const u = me(req);
    const loan = getLoan(ctx, (req.params as { id: string }).id);
    if (!loan || loan.user_id !== u.id) throw new HttpError(404, 'Кредит не найден');
    const { fromAccountId, full } = z.object({ fromAccountId: z.string(), full: z.boolean().default(false) }).parse(req.body);
    const from = ownedAccount(ctx, u.id, fromAccountId);
    if (from.currency !== 'RUB') throw new HttpError(400, 'Платёж по кредиту — с рублёвого счёта');
    if (full) return { paid: repayLoan(ctx, loan, from, u.id) };
    if (loan.status === 'closed') throw new HttpError(400, 'Кредит погашен');
    if (!payInstalment(ctx, loan, from, u.id)) throw new HttpError(400, 'Недостаточно средств для платежа');
    return { ok: true };
  });

  // ---------- Notifications & purchase confirmations ----------
  app.get('/api/notifications', async (req) => {
    const u = me(req);
    const items = db.prepare('SELECT id, kind, title, body, data, created_at createdAt, read_at readAt FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 60').all(u.id) as { data: string }[];
    return { items: items.map((i) => ({ ...i, data: safeJson(i.data, {}) })) };
  });

  app.post('/api/notifications/read', async (req) => {
    db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(ctx.now(), me(req).id);
    return { ok: true };
  });

  /** Polled by the app every few seconds: purchase confirmations pop up over any screen. */
  app.get('/api/pulse', async (req) => {
    const u = me(req);
    const unread = (db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read_at IS NULL').get(u.id) as { c: number }).c;
    const chatUnread = (db.prepare('SELECT COALESCE(SUM(unread_client), 0) c FROM support_threads WHERE user_id = ?').get(u.id) as { c: number }).c;
    return { confirmations: pendingConfirmations(ctx, u.id), requests: pendingRequests(ctx, u.id), partnerRequests: pendingPartnerRequests(ctx, u.id), unread, chatUnread };
  });

  app.post('/api/confirmations/:id', async (req) => {
    const u = me(req);
    const { approve } = z.object({ approve: z.boolean() }).parse(req.body);
    const r = decide(ctx, u.id, (req.params as { id: string }).id, approve);
    audit(ctx, req, approve ? 'purchase_approve' : 'purchase_decline', 'authorization', (req.params as { id: string }).id);
    return r;
  });

  // ---------- Business: connect a GPAY shop ----------
  app.post('/api/accounts/:id/gpay-code', async (req) => {
    const u = me(req);
    const acc = ownedAccount(ctx, u.id, (req.params as { id: string }).id);
    if (acc.kind !== 'business' && acc.kind !== 'current') throw new HttpError(400, 'Выплаты из GPAY принимают платёжные и бизнес-счета');
    const code = `${randomDigits(4)}-${randomDigits(4)}`;
    db.prepare('INSERT INTO gpay_links(id, account_id, code_hash, expires_at, created_at) VALUES(?,?,?,?,?)').run(newId('gpl', 12), acc.id, sha256(code), ctx.now() + 30 * 60_000, ctx.now());
    return { code, expiresAt: ctx.now() + 30 * 60_000 };
  });

  app.get('/api/meta', async () => ({
    bank: BANK,
    corr: CORR_ACCOUNT,
    categories: Object.entries(CATEGORIES).map(([id, c]) => ({ id, title: c.title })),
    designs: DESIGNS,
    tariffs: TARIFFS,
    gpayUrl: ctx.cfg.gpayPublicUrl || null,
    gosUrl: gosEnabled(ctx) ? ctx.cfg.gosPublicUrl : null,
  }));
}
