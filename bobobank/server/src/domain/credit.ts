import { HttpError, type Ctx } from '../context.js';
import { getSetting, setSetting, type DB } from '../db.js';
import { DAY, newId, safeJson } from '../util.js';
import { issueCard, NETWORKS, type Design, type Network } from './cards.js';
import {
  activeRestrictions, available, getAccount, mainAccount, notify, openAccount, post, systemAccount, userAccounts, type AccountRow,
} from './ledger.js';
import { humanMoney } from './money.js';
import { getUser } from './transfers.js';

// ---------- Product settings (editable in the admin panel) ----------

export interface Products {
  savingsRate: number;
  deposits: { months: number; rate: number }[];
  loanRate: number;
  loanMin: number;
  loanMax: number;
  creditCardRate: number;
  creditCardGraceDays: number;
  creditCardMax: number;
  minPaymentPct: number;
  latePenalty: number;
  /** Scores: at or above `approve` → automatic approval, below `reject` → automatic refusal, between → manual review. */
  scoreApprove: number;
  scoreReject: number;
}

export const DEFAULT_PRODUCTS: Products = {
  savingsRate: 14,
  deposits: [
    { months: 3, rate: 18 },
    { months: 6, rate: 17 },
    { months: 12, rate: 15.5 },
    { months: 24, rate: 13 },
  ],
  loanRate: 24.9,
  loanMin: 3_000_000,
  loanMax: 500_000_000,
  creditCardRate: 34.9,
  creditCardGraceDays: 120,
  creditCardMax: 100_000_000,
  minPaymentPct: 3,
  latePenalty: 50_000,
  scoreApprove: 650,
  scoreReject: 560,
};

export const getProducts = (db: DB): Products => ({ ...DEFAULT_PRODUCTS, ...getSetting<Partial<Products>>(db, 'products', {}) });
export const setProducts = (db: DB, p: Products) => setSetting(db, 'products', p);

const addMonths = (ts: number, n: number) => {
  const d = new Date(ts);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.getTime();
};

// ---------- Savings and deposits ----------

interface InterestParams {
  rate: number;
  lastAccrual: number;
  interest?: number;
  months?: number;
  endsAt?: number;
  payoutAccountId?: string;
}

export function openSavings(ctx: Ctx, userId: string, currency = 'RUB') {
  if (userAccounts(ctx, userId).some((a) => a.kind === 'savings' && a.currency === currency)) throw new HttpError(400, 'Накопительный счёт уже открыт');
  const p = getProducts(ctx.db);
  return openAccount(ctx, userId, 'savings', currency, 'Накопительный счёт', { params: { rate: p.savingsRate, lastAccrual: ctx.now(), interest: 0 } });
}

export function openDeposit(ctx: Ctx, userId: string, from: AccountRow, amount: number, months: number) {
  const p = getProducts(ctx.db);
  const plan = p.deposits.find((d) => d.months === months);
  if (!plan) throw new HttpError(400, 'Такого срока вклада нет');
  if (from.currency !== 'RUB') throw new HttpError(400, 'Вклад открывается в рублях');
  if (amount < 1_000_000) throw new HttpError(400, 'Минимальная сумма вклада — 10 000 ₽');
  const now = ctx.now();
  const dep = openAccount(ctx, userId, 'deposit', 'RUB', `Вклад «Бобо» на ${months} мес.`, {
    params: { rate: plan.rate, months, endsAt: addMonths(now, months), lastAccrual: now, interest: 0, payoutAccountId: from.id } satisfies InterestParams,
  });
  post(ctx, {
    kind: 'deposit_open',
    description: 'Открытие вклада',
    initiatorId: userId,
    legs: [
      { account: from, amount: -amount, title: dep.name, subtitle: `Открытие вклада под ${plan.rate}%`, category: 'savings' },
      { account: dep, amount, title: 'Пополнение вклада', subtitle: `Со счёта •• ${from.number.slice(-4)}`, category: 'savings' },
    ],
  });
  return getAccount(ctx, dep.id)!;
}

/** Closes a deposit/savings account. Before the end date a deposit loses its accrued interest. */
export function closeInterestAccount(ctx: Ctx, userId: string, acc: AccountRow, to: AccountRow, byBank = false) {
  if (acc.kind !== 'deposit' && acc.kind !== 'savings') throw new HttpError(400, 'Это не вклад');
  const prm = safeJson<InterestParams>(acc.params, { rate: 0, lastAccrual: 0 });
  const early = acc.kind === 'deposit' && !byBank && (prm.endsAt ?? 0) > ctx.now();
  const forfeit = early ? Math.min(prm.interest ?? 0, acc.balance) : 0;
  ctx.db.transaction(() => {
    if (forfeit > 0) {
      post(ctx, {
        kind: 'interest_forfeit',
        description: 'Досрочное закрытие вклада',
        legs: [
          { account: acc, amount: -forfeit, title: 'Удержание процентов', subtitle: 'Досрочное закрытие вклада', category: 'savings', force: true },
          { account: systemAccount(ctx, 'interest_expense', acc.currency), amount: forfeit },
        ],
      });
    }
    const rest = getAccount(ctx, acc.id)!.balance;
    if (rest > 0) {
      post(ctx, {
        kind: 'deposit_close',
        description: `Закрытие: ${acc.name}`,
        initiatorId: userId,
        legs: [
          { account: getAccount(ctx, acc.id)!, amount: -rest, title: acc.name, subtitle: 'Закрытие и перевод остатка', category: 'savings', force: true },
          { account: to, amount: rest, title: acc.name, subtitle: early ? 'Досрочное закрытие вклада' : 'Возврат вклада с процентами', category: 'savings' },
        ],
      });
    }
    ctx.db.prepare(`UPDATE accounts SET status = 'closed', closed_at = ? WHERE id = ?`).run(ctx.now(), acc.id);
  })();
  return { forfeit };
}

/** Daily interest on savings and deposits, capitalised every day. */
function accrueInterest(ctx: Ctx) {
  const now = ctx.now();
  const rows = ctx.db.prepare(`SELECT * FROM accounts WHERE kind IN ('savings', 'deposit') AND status = 'open'`).all() as AccountRow[];
  for (const acc of rows) {
    const prm = safeJson<InterestParams>(acc.params, { rate: 0, lastAccrual: now });
    const days = Math.floor((now - prm.lastAccrual) / DAY);
    if (acc.kind === 'deposit' && prm.endsAt && prm.endsAt <= now) {
      maturity(ctx, acc, prm);
      continue;
    }
    if (days < 1) continue;
    const interest = Math.floor((acc.balance * prm.rate * days) / 100 / 365);
    prm.lastAccrual += days * DAY;
    if (interest > 0) {
      prm.interest = (prm.interest ?? 0) + interest;
      post(ctx, {
        kind: 'interest',
        description: 'Проценты',
        legs: [
          { account: systemAccount(ctx, 'interest_expense', acc.currency), amount: -interest },
          { account: acc, amount: interest, title: 'Проценты', subtitle: `${prm.rate}% годовых, капитализация`, category: 'savings' },
        ],
      });
    }
    ctx.db.prepare('UPDATE accounts SET params = ? WHERE id = ?').run(JSON.stringify(prm), acc.id);
  }
}

function maturity(ctx: Ctx, acc: AccountRow, prm: InterestParams) {
  const to = (prm.payoutAccountId && getAccount(ctx, prm.payoutAccountId)?.status === 'open' ? getAccount(ctx, prm.payoutAccountId) : mainAccount(ctx, acc.user_id!)) ?? null;
  if (!to) return;
  const total = acc.balance;
  closeInterestAccount(ctx, acc.user_id!, acc, to, true);
  notify(ctx, acc.user_id!, 'deposit', 'Срок вклада закончился', `${humanMoney(total, acc.currency)} с процентами переведены на счёт •• ${to.number.slice(-4)}`);
}

// ---------- Scoring and applications ----------

export interface ScoreFactors {
  tenureDays: number;
  income30: number;
  overdue: boolean;
  monthlyDebt: number;
  restricted: boolean;
}

export function scoreFactors(ctx: Ctx, userId: string): ScoreFactors {
  const now = ctx.now();
  const u = ctx.db.prepare('SELECT created_at FROM users WHERE id = ?').get(userId) as { created_at: number };
  const income = ctx.db
    .prepare(
      `SELECT COALESCE(SUM(e.amount), 0) s FROM entries e JOIN accounts a ON a.id = e.account_id
       WHERE a.user_id = ? AND e.currency = 'RUB' AND e.amount > 0 AND e.category = 'income' AND e.created_at >= ?`,
    )
    .get(userId, now - 30 * DAY) as { s: number };
  const loans = ctx.db.prepare(`SELECT payment, status FROM loans WHERE user_id = ? AND status IN ('active', 'overdue')`).all(userId) as { payment: number; status: string }[];
  const cards = ctx.db.prepare(`SELECT credit_limit, params FROM accounts WHERE user_id = ? AND kind = 'credit_card' AND status = 'open'`).all(userId) as { credit_limit: number; params: string }[];
  const cardOverdue = cards.some((c) => safeJson<{ overdue?: boolean }>(c.params, {}).overdue);
  return {
    tenureDays: Math.floor((now - u.created_at) / DAY),
    income30: income.s,
    overdue: loans.some((l) => l.status === 'overdue') || cardOverdue,
    monthlyDebt: loans.reduce((s, l) => s + l.payment, 0) + cards.reduce((s, c) => s + Math.round(c.credit_limit * 0.05), 0),
    restricted: activeRestrictions(ctx, userId).length > 0,
  };
}

export function computeScore(f: ScoreFactors): number {
  let s = 520;
  s += Math.min(f.tenureDays, 365) * (90 / 365);
  s += Math.min(f.income30 / 10_000_000, 1) * 160;
  s += Math.min(f.income30 / 1_000_000, 1) * 40;
  if (f.overdue) s -= 220;
  const load = f.income30 > 0 ? f.monthlyDebt / f.income30 : f.monthlyDebt > 0 ? 1 : 0;
  s -= Math.min(load, 1.5) * 160;
  if (f.restricted) s -= 300;
  return Math.max(300, Math.min(900, Math.round(s)));
}

/** Largest amount the bank is ready to lend given the income: ×3 for cash loans, ×2 for credit cards. */
export function offerLimit(ctx: Ctx, product: 'loan' | 'credit_card', f: ScoreFactors): number {
  const p = getProducts(ctx.db);
  const base = Math.max(f.income30 - f.monthlyDebt, 0) * (product === 'loan' ? 3 : 2);
  const floor = product === 'loan' ? p.loanMin * 2 : 3_000_000;
  const max = product === 'loan' ? p.loanMax : p.creditCardMax;
  return Math.max(floor, Math.min(max, Math.floor(base / 100_000) * 100_000));
}

export interface ApplicationRow {
  id: string;
  user_id: string;
  product: 'loan' | 'credit_card';
  amount: number;
  term: number;
  status: 'processing' | 'review' | 'approved' | 'rejected' | 'issued' | 'canceled';
  score: number | null;
  factors: string;
  offer_amount: number | null;
  offer_rate: number | null;
  reason: string | null;
  decided_by: string | null;
  result_id: string | null;
  decide_at: number | null;
  created_at: number;
  decided_at: number | null;
}

export const SCORING_DELAY_MS = 4000;

export function apply(ctx: Ctx, userId: string, product: 'loan' | 'credit_card', amount: number, term: number, extra: { network?: Network; design?: Design } = {}) {
  const p = getProducts(ctx.db);
  if (product === 'loan') {
    if (amount < p.loanMin || amount > p.loanMax) throw new HttpError(400, `Сумма кредита — от ${humanMoney(p.loanMin, 'RUB')} до ${humanMoney(p.loanMax, 'RUB')}`);
    if (term < 3 || term > 60) throw new HttpError(400, 'Срок кредита — от 3 до 60 месяцев');
  } else {
    if (amount < 1_000_000 || amount > p.creditCardMax) throw new HttpError(400, `Лимит — от 10 000 ₽ до ${humanMoney(p.creditCardMax, 'RUB')}`);
    if (extra.network && !NETWORKS.includes(extra.network)) throw new HttpError(400, 'Платёжная система не поддерживается');
  }
  const open = ctx.db.prepare(`SELECT 1 FROM applications WHERE user_id = ? AND status IN ('processing', 'review', 'approved')`).get(userId);
  if (open) throw new HttpError(400, 'У вас уже есть заявка на рассмотрении');
  const id = newId('app', 16);
  ctx.db
    .prepare('INSERT INTO applications(id, user_id, product, amount, term, status, factors, decide_at, created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id, userId, product, amount, product === 'loan' ? term : 0, 'processing', JSON.stringify({ network: extra.network ?? 'mir', design: extra.design ?? 'black' }), ctx.now() + SCORING_DELAY_MS, ctx.now());
  return getApplication(ctx, id)!;
}

export const getApplication = (ctx: Ctx, id: string) => ctx.db.prepare('SELECT * FROM applications WHERE id = ?').get(id) as ApplicationRow | undefined;

/** Automatic decision a few seconds after the application. */
export function score(ctx: Ctx, a: ApplicationRow) {
  const p = getProducts(ctx.db);
  const f = scoreFactors(ctx, a.user_id);
  const s = computeScore(f);
  const limit = offerLimit(ctx, a.product, f);
  const rate = a.product === 'loan' ? p.loanRate : p.creditCardRate;
  const extra = safeJson<Record<string, unknown>>(a.factors, {});
  const factors = JSON.stringify({ ...extra, ...f, limit });
  let status: ApplicationRow['status'];
  let reason: string | null = null;
  if (f.restricted) {
    status = 'rejected';
    reason = 'По вашим счетам действуют ограничения';
  } else if (f.overdue) {
    status = 'rejected';
    reason = 'Есть просроченная задолженность';
  } else if (s >= p.scoreApprove) {
    status = 'approved';
  } else if (s < p.scoreReject) {
    status = 'rejected';
    reason = 'Недостаточно подтверждённого дохода. Пользуйтесь картой и получайте поступления — и попробуйте через месяц.';
  } else {
    status = 'review';
  }
  const offer = status === 'approved' || status === 'review' ? Math.min(a.amount, limit) : null;
  ctx.db
    .prepare('UPDATE applications SET status = ?, score = ?, factors = ?, offer_amount = ?, offer_rate = ?, reason = ?, decided_at = ? WHERE id = ?')
    .run(status, s, factors, offer, offer ? rate : null, reason, status === 'review' ? null : ctx.now(), a.id);
  const title = a.product === 'loan' ? 'кредит' : 'кредитную карту';
  if (status === 'approved') notify(ctx, a.user_id, 'credit', `Заявка на ${title} одобрена`, `Одобрено ${humanMoney(offer!, 'RUB')} под ${rate}%`, { applicationId: a.id });
  if (status === 'rejected') notify(ctx, a.user_id, 'credit', `Заявка на ${title} отклонена`, reason ?? '', { applicationId: a.id });
  if (status === 'review') notify(ctx, a.user_id, 'credit', 'Заявка на дополнительной проверке', 'Решение примет специалист банка', { applicationId: a.id });
}

/** Manual decision by a bank officer for applications in review (or to revise an automatic one). */
export function review(ctx: Ctx, a: ApplicationRow, officerId: string, approve: boolean, amount?: number, rate?: number, reason?: string) {
  if (!['review', 'approved', 'rejected'].includes(a.status)) throw new HttpError(400, 'Заявку уже нельзя пересмотреть');
  if (approve) {
    const offer = amount ?? a.offer_amount ?? a.amount;
    const r = rate ?? a.offer_rate ?? (a.product === 'loan' ? getProducts(ctx.db).loanRate : getProducts(ctx.db).creditCardRate);
    ctx.db.prepare(`UPDATE applications SET status = 'approved', offer_amount = ?, offer_rate = ?, reason = ?, decided_by = ?, decided_at = ? WHERE id = ?`).run(offer, r, reason ?? null, officerId, ctx.now(), a.id);
    notify(ctx, a.user_id, 'credit', 'Заявка одобрена', `Одобрено ${humanMoney(offer, 'RUB')} под ${r}%`, { applicationId: a.id });
  } else {
    ctx.db.prepare(`UPDATE applications SET status = 'rejected', offer_amount = NULL, reason = ?, decided_by = ?, decided_at = ? WHERE id = ?`).run(reason || 'Банк не готов предоставить кредит', officerId, ctx.now(), a.id);
    notify(ctx, a.user_id, 'credit', 'Заявка отклонена', reason || 'Банк не готов предоставить кредит', { applicationId: a.id });
  }
}

/** The customer accepts an approved offer: money arrives / the card is issued. */
export function acceptOffer(ctx: Ctx, userId: string, a: ApplicationRow) {
  if (a.user_id !== userId) throw new HttpError(404, 'Заявка не найдена');
  if (a.status !== 'approved' || !a.offer_amount || !a.offer_rate) throw new HttpError(400, 'Заявка не одобрена');
  const user = getUser(ctx, userId)!;
  let resultId: string;
  if (a.product === 'loan') {
    resultId = issueLoan(ctx, userId, a.offer_amount, a.term, a.offer_rate).id;
  } else {
    const extra = safeJson<{ network?: Network; design?: Design }>(a.factors, {});
    const acc = openAccount(ctx, userId, 'credit_card', 'RUB', 'Кредитная карта', {
      creditLimit: a.offer_amount,
      params: { rate: a.offer_rate, graceDays: getProducts(ctx.db).creditCardGraceDays, debtSince: null, lastAccrual: ctx.now(), statementAt: ctx.now(), minDue: 0, minDueAt: null, overdue: false },
    });
    resultId = issueCard(ctx, { userId, account: acc, network: extra.network ?? 'mir', kind: 'credit', form: 'virtual', tariff: user.tariff === 'prime' ? 'prime' : 'standard', design: extra.design ?? 'black', holder: user.name }).id;
  }
  ctx.db.prepare(`UPDATE applications SET status = 'issued', result_id = ? WHERE id = ?`).run(resultId, a.id);
  return resultId;
}

// ---------- Cash loans ----------

export interface ScheduleItem {
  n: number;
  dueAt: number;
  payment: number;
  principal: number;
  interest: number;
  paid: boolean;
}

export function annuity(principal: number, ratePct: number, months: number): { payment: number; schedule: Omit<ScheduleItem, 'dueAt' | 'paid'>[] } {
  const r = ratePct / 100 / 12;
  const payment = Math.ceil(r === 0 ? principal / months : (principal * r) / (1 - (1 + r) ** -months));
  let rest = principal;
  const schedule = [];
  for (let n = 1; n <= months; n++) {
    const interest = Math.round(rest * r);
    let body = payment - interest;
    if (n === months) body = rest;
    rest -= body;
    schedule.push({ n, payment: body + interest, principal: body, interest });
  }
  return { payment, schedule };
}

export interface LoanRow {
  id: string;
  user_id: string;
  account_id: string;
  payout_account_id: string;
  principal: number;
  rate: number;
  term: number;
  payment: number;
  schedule: string;
  penalty: number;
  status: 'active' | 'overdue' | 'closed';
  created_at: number;
  closed_at: number | null;
}

export function issueLoan(ctx: Ctx, userId: string, principal: number, term: number, rate: number): LoanRow {
  const payout = mainAccount(ctx, userId);
  if (!payout) throw new HttpError(400, 'Нет рублёвого счёта для зачисления кредита');
  const now = ctx.now();
  const { payment, schedule } = annuity(principal, rate, term);
  const items: ScheduleItem[] = schedule.map((s) => ({ ...s, dueAt: addMonths(now, s.n), paid: false }));
  const acc = openAccount(ctx, userId, 'loan', 'RUB', `Кредит наличными ${humanMoney(principal, 'RUB')}`, { params: { rate } });
  const id = newId('loan', 16);
  ctx.db.transaction(() => {
    ctx.db
      .prepare('INSERT INTO loans(id, user_id, account_id, payout_account_id, principal, rate, term, payment, schedule, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(id, userId, acc.id, payout.id, principal, rate, term, payment, JSON.stringify(items), now);
    post(ctx, {
      kind: 'loan_issue',
      description: 'Выдача кредита',
      legs: [
        { account: acc, amount: -principal, title: 'Выдача кредита', subtitle: `${rate}% на ${term} мес.`, category: 'credit', force: true },
        { account: payout, amount: principal, title: 'Кредит наличными', subtitle: `${rate}% на ${term} мес.`, category: 'credit' },
      ],
    });
  })();
  notify(ctx, userId, 'credit', `Кредит ${humanMoney(principal, 'RUB')} зачислен`, `Ежемесячный платёж ${humanMoney(payment, 'RUB')}`);
  return getLoan(ctx, id)!;
}

export const getLoan = (ctx: Ctx, id: string) => ctx.db.prepare('SELECT * FROM loans WHERE id = ?').get(id) as LoanRow | undefined;

/** Pays the next scheduled instalment (and any penalty) from the given account. */
export function payInstalment(ctx: Ctx, loan: LoanRow, from: AccountRow, initiatorId: string | null = null): boolean {
  const items = safeJson<ScheduleItem[]>(loan.schedule, []);
  const next = items.find((i) => !i.paid);
  if (!next) return false;
  const due = next.payment + loan.penalty;
  if (available(ctx, from) < due) return false;
  const loanAcc = getAccount(ctx, loan.account_id)!;
  ctx.db.transaction(() => {
    post(ctx, {
      kind: 'loan_payment',
      description: `Платёж по кредиту №${next.n}`,
      initiatorId,
      legs: [
        { account: from, amount: -due, title: 'Платёж по кредиту', subtitle: `Платёж ${next.n} из ${loan.term}${loan.penalty ? ', с пенями' : ''}`, category: 'credit' },
        { account: loanAcc, amount: next.principal, title: 'Погашение основного долга', subtitle: `Платёж ${next.n} из ${loan.term}`, category: 'credit' },
        { account: systemAccount(ctx, 'interest_income', 'RUB'), amount: next.interest + loan.penalty },
      ],
    });
    next.paid = true;
    const closed = items.every((i) => i.paid);
    ctx.db.prepare('UPDATE loans SET schedule = ?, penalty = 0, status = ?, closed_at = ? WHERE id = ?').run(JSON.stringify(items), closed ? 'closed' : 'active', closed ? ctx.now() : null, loan.id);
    if (closed) ctx.db.prepare(`UPDATE accounts SET status = 'closed', closed_at = ? WHERE id = ?`).run(ctx.now(), loan.account_id);
  })();
  return true;
}

/** Full early repayment: the remaining principal plus interest accrued in the current period. */
export function repayLoan(ctx: Ctx, loan: LoanRow, from: AccountRow, initiatorId: string) {
  if (loan.status === 'closed') throw new HttpError(400, 'Кредит уже погашен');
  const items = safeJson<ScheduleItem[]>(loan.schedule, []);
  const next = items.find((i) => !i.paid)!;
  const rest = items.filter((i) => !i.paid).reduce((s, i) => s + i.principal, 0);
  const periodStart = next.n === 1 ? loan.created_at : items[next.n - 2].dueAt;
  const days = Math.max(0, Math.min(31, Math.ceil((ctx.now() - periodStart) / DAY)));
  const interest = Math.round((rest * loan.rate * days) / 100 / 365) + loan.penalty;
  const total = rest + interest;
  if (available(ctx, from) < total) throw new HttpError(400, `Для полного погашения нужно ${humanMoney(total, 'RUB')}`);
  const loanAcc = getAccount(ctx, loan.account_id)!;
  ctx.db.transaction(() => {
    post(ctx, {
      kind: 'loan_repay',
      description: 'Досрочное погашение кредита',
      initiatorId,
      legs: [
        { account: from, amount: -total, title: 'Досрочное погашение кредита', subtitle: 'Полное погашение', category: 'credit' },
        { account: loanAcc, amount: rest, title: 'Досрочное погашение', subtitle: 'Основной долг', category: 'credit' },
        ...(interest ? [{ account: systemAccount(ctx, 'interest_income', 'RUB'), amount: interest }] : []),
      ],
    });
    for (const i of items) i.paid = true;
    ctx.db.prepare(`UPDATE loans SET schedule = ?, penalty = 0, status = 'closed', closed_at = ? WHERE id = ?`).run(JSON.stringify(items), ctx.now(), loan.id);
    ctx.db.prepare(`UPDATE accounts SET status = 'closed', closed_at = ? WHERE id = ?`).run(ctx.now(), loan.account_id);
  })();
  notify(ctx, loan.user_id, 'credit', 'Кредит полностью погашен', `Списано ${humanMoney(total, 'RUB')}`);
  return total;
}

function serviceLoans(ctx: Ctx) {
  const now = ctx.now();
  const loans = ctx.db.prepare(`SELECT * FROM loans WHERE status IN ('active', 'overdue')`).all() as LoanRow[];
  for (const loan of loans) {
    const items = safeJson<ScheduleItem[]>(loan.schedule, []);
    const next = items.find((i) => !i.paid);
    if (!next || next.dueAt > now) continue;
    const from = getAccount(ctx, loan.payout_account_id);
    if (from && from.status === 'open' && payInstalment(ctx, loan, from)) {
      notify(ctx, loan.user_id, 'credit', 'Платёж по кредиту списан', `${humanMoney(next.payment + loan.penalty, 'RUB')}, платёж ${next.n} из ${loan.term}`);
      continue;
    }
    // Not enough money: overdue, penalty 0.1% of the instalment per day (charged at most once a day).
    const p = safeJson<{ lastPenalty?: number }>((getAccount(ctx, loan.account_id)?.params ?? '{}'), {});
    if (!p.lastPenalty || now - p.lastPenalty >= DAY) {
      const pen = Math.max(100, Math.round(next.payment * 0.001));
      ctx.db.prepare(`UPDATE loans SET status = 'overdue', penalty = penalty + ? WHERE id = ?`).run(pen, loan.id);
      ctx.db.prepare('UPDATE accounts SET params = ? WHERE id = ?').run(JSON.stringify({ ...p, lastPenalty: now }), loan.account_id);
      if (loan.status !== 'overdue') notify(ctx, loan.user_id, 'credit', 'Просрочен платёж по кредиту', `Пополните счёт на ${humanMoney(next.payment, 'RUB')} — платёж спишется автоматически`);
    }
  }
}

// ---------- Credit cards ----------

interface CreditParams {
  rate: number;
  graceDays: number;
  debtSince: number | null;
  lastAccrual: number;
  statementAt: number;
  minDue: number;
  minDueAt: number | null;
  overdue: boolean;
}

function serviceCreditCards(ctx: Ctx) {
  const now = ctx.now();
  const p = getProducts(ctx.db);
  const rows = ctx.db.prepare(`SELECT * FROM accounts WHERE kind = 'credit_card' AND status = 'open'`).all() as AccountRow[];
  for (const acc of rows) {
    const prm = safeJson<CreditParams>(acc.params, { rate: p.creditCardRate, graceDays: p.creditCardGraceDays, debtSince: null, lastAccrual: now, statementAt: now, minDue: 0, minDueAt: null, overdue: false });
    const debt = Math.max(0, -acc.balance);
    if (debt === 0) Object.assign(prm, { debtSince: null, minDue: 0, minDueAt: null, overdue: false });
    else if (!prm.debtSince) prm.debtSince = now;

    const days = Math.floor((now - prm.lastAccrual) / DAY);
    if (days >= 1) {
      prm.lastAccrual += days * DAY;
      if (debt > 0 && prm.debtSince && now - prm.debtSince > prm.graceDays * DAY) {
        const interest = Math.round((debt * prm.rate * days) / 100 / 365);
        if (interest > 0) {
          post(ctx, {
            kind: 'interest',
            description: 'Проценты по кредитной карте',
            legs: [
              { account: acc, amount: -interest, title: 'Проценты по кредитной карте', subtitle: `Льготный период закончился, ${prm.rate}% годовых`, category: 'credit', force: true },
              { account: systemAccount(ctx, 'interest_income', 'RUB'), amount: interest },
            ],
          });
        }
      }
    }

    // Monthly statement: minimum payment due in 20 days.
    if (now - prm.statementAt >= 30 * DAY) {
      prm.statementAt = now;
      if (debt > 0) {
        prm.minDue = Math.min(debt, Math.max(30_000, Math.round((debt * p.minPaymentPct) / 100)));
        prm.minDueAt = now + 20 * DAY;
        notify(ctx, acc.user_id!, 'credit', 'Выписка по кредитной карте', `Минимальный платёж ${humanMoney(prm.minDue, 'RUB')} до ${new Date(prm.minDueAt).toLocaleDateString('ru-RU')}`);
      }
    }
    if (prm.minDueAt && prm.minDueAt <= now && prm.minDue > 0) {
      const paid = (ctx.db.prepare('SELECT COALESCE(SUM(amount), 0) s FROM entries WHERE account_id = ? AND amount > 0 AND created_at >= ?').get(acc.id, prm.statementAt) as { s: number }).s;
      if (paid < prm.minDue && !prm.overdue) {
        prm.overdue = true;
        post(ctx, {
          kind: 'penalty',
          description: 'Штраф за пропуск платежа',
          legs: [
            { account: getAccount(ctx, acc.id)!, amount: -p.latePenalty, title: 'Штраф за пропуск минимального платежа', subtitle: 'Кредитная карта', category: 'fees', force: true },
            { account: systemAccount(ctx, 'interest_income', 'RUB'), amount: p.latePenalty },
          ],
        });
        notify(ctx, acc.user_id!, 'credit', 'Пропущен минимальный платёж', 'Начислен штраф. Внесите платёж, чтобы не испортить кредитную историю.');
      }
      if (paid >= prm.minDue) Object.assign(prm, { minDue: 0, minDueAt: null, overdue: false });
    }
    ctx.db.prepare('UPDATE accounts SET params = ? WHERE id = ?').run(JSON.stringify(prm), acc.id);
  }
}

// ---------- Tariff fees ----------

function chargePrime(ctx: Ctx) {
  const now = ctx.now();
  const users = ctx.db.prepare(`SELECT id, tariff_paid_until FROM users WHERE tariff = 'prime' AND (tariff_paid_until IS NULL OR tariff_paid_until <= ?)`).all(now) as { id: string; tariff_paid_until: number | null }[];
  for (const u of users) chargePrimeFee(ctx, u.id);
}

export const PRIME_FEE = 39_900;

/** Charges a month of Bobo Prime; without money on the main account the tariff falls back to standard. */
export function chargePrimeFee(ctx: Ctx, userId: string): boolean {
  const acc = mainAccount(ctx, userId);
  if (!acc || available(ctx, acc) < PRIME_FEE) {
    ctx.db.prepare(`UPDATE users SET tariff = 'standard', tariff_paid_until = NULL WHERE id = ?`).run(userId);
    notify(ctx, userId, 'tariff', 'Подписка Bobo Prime приостановлена', 'Не хватило денег на оплату. Пополните счёт и подключите снова.');
    return false;
  }
  post(ctx, {
    kind: 'fee',
    description: 'Bobo Prime',
    legs: [
      { account: acc, amount: -PRIME_FEE, title: 'Bobo Prime', subtitle: 'Подписка на месяц', category: 'fees' },
      { account: systemAccount(ctx, 'fees', 'RUB'), amount: PRIME_FEE },
    ],
  });
  ctx.db.prepare(`UPDATE users SET tariff = 'prime', tariff_paid_until = ? WHERE id = ?`).run(addMonths(ctx.now(), 1), userId);
  return true;
}

export function tickCredit(ctx: Ctx) {
  const due = ctx.db.prepare(`SELECT * FROM applications WHERE status = 'processing' AND decide_at <= ?`).all(ctx.now()) as ApplicationRow[];
  for (const a of due) score(ctx, a);
  accrueInterest(ctx);
  serviceLoans(ctx);
  serviceCreditCards(ctx);
  chargePrime(ctx);
}
