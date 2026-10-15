import { HttpError, type Ctx } from '../context.js';
import { newId, safeJson } from '../util.js';
import { BANK, newAccountNumber, PREFIX, RESTRICTION_REASONS, type Category, type RestrictionReason } from './bank.js';

export type AccountKind = 'current' | 'savings' | 'deposit' | 'credit_card' | 'loan' | 'business' | 'kids' | 'system';

export interface AccountRow {
  id: string;
  number: string;
  user_id: string | null;
  kind: AccountKind;
  currency: string;
  name: string;
  balance: number;
  credit_limit: number;
  status: 'open' | 'closed';
  params: string;
  system_code: string | null;
  created_at: number;
  closed_at: number | null;
}

/** The bank's own accounts, one per currency. They may go negative: they are the other side of customer money. */
export const SYSTEM = {
  capital: 'Собственные средства банка',
  fees: 'Комиссионные доходы',
  interest_expense: 'Процентные расходы по вкладам',
  interest_income: 'Процентные доходы по кредитам',
  loans: 'Ссудный фонд',
  gpay: 'Расчёты с платёжным сервисом GPAY',
  fx: 'Валютная позиция',
  bonus: 'Бонусная программа «Бобобонусы»',
  external: 'Переводы в другие банки',
  psy: 'Обмен псякоинов Бобуслуг',
  market: 'Брокерские операции',
  transport: 'Расчёты с сервисом «Бобо.Транспорт»',
} as const;
export type SystemCode = keyof typeof SYSTEM;

export function systemAccount(ctx: Ctx, code: SystemCode, currency: string): AccountRow {
  const key = `${code}:${currency}`;
  let row = ctx.db.prepare('SELECT * FROM accounts WHERE system_code = ?').get(key) as AccountRow | undefined;
  if (!row) {
    const id = newId('acc', 16);
    ctx.db
      .prepare(`INSERT INTO accounts(id, number, user_id, kind, currency, name, system_code, created_at) VALUES(?,?,NULL,'system',?,?,?,?)`)
      .run(id, newAccountNumber(PREFIX.system, currency), currency, SYSTEM[code], key, ctx.now());
    row = ctx.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow;
  }
  return row;
}

export function getAccount(ctx: Ctx, id: string): AccountRow | undefined {
  return ctx.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
}

export function openAccount(ctx: Ctx, userId: string, kind: Exclude<AccountKind, 'system'>, currency: string, name: string, opts: { params?: object; creditLimit?: number; prefix?: string } = {}): AccountRow {
  const id = newId('acc', 16);
  const prefix = opts.prefix ?? (kind === 'business' ? PREFIX.business_ip : PREFIX[kind]);
  ctx.db
    .prepare('INSERT INTO accounts(id, number, user_id, kind, currency, name, credit_limit, params, created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id, newAccountNumber(prefix, currency), userId, kind, currency, name, opts.creditLimit ?? 0, JSON.stringify(opts.params ?? {}), ctx.now());
  return getAccount(ctx, id)!;
}

export interface Restriction {
  id: string;
  user_id: string;
  account_id: string | null;
  type: 'arrest' | 'block_debit' | 'block_full';
  amount: number;
  reason: RestrictionReason;
  comment: string;
  created_at: number;
}

export function activeRestrictions(ctx: Ctx, userId: string): Restriction[] {
  return ctx.db.prepare('SELECT * FROM restrictions WHERE user_id = ? AND lifted_at IS NULL ORDER BY created_at').all(userId) as Restriction[];
}

const appliesTo = (r: Restriction, accountId: string) => r.account_id === null || r.account_id === accountId;

export function heldAmount(ctx: Ctx, accountId: string): number {
  return (ctx.db.prepare(`SELECT COALESCE(SUM(amount), 0) s FROM holds WHERE account_id = ? AND status = 'active'`).get(accountId) as { s: number }).s;
}

export function arrestedAmount(ctx: Ctx, acc: AccountRow): number {
  if (!acc.user_id) return 0;
  return activeRestrictions(ctx, acc.user_id)
    .filter((r) => r.type === 'arrest' && r.account_id === acc.id)
    .reduce((s, r) => s + r.amount, 0);
}

/** What the customer can spend right now: own money + credit limit − card holds − arrested sums. */
export function available(ctx: Ctx, acc: AccountRow, excludeHold?: string): number {
  let held = heldAmount(ctx, acc.id);
  if (excludeHold) {
    const h = ctx.db.prepare(`SELECT amount FROM holds WHERE id = ? AND status = 'active'`).get(excludeHold) as { amount: number } | undefined;
    held -= h?.amount ?? 0;
  }
  return acc.balance + acc.credit_limit - held - arrestedAmount(ctx, acc);
}

/** Throws a customer-readable error when debits from the account are restricted. */
export function assertDebitAllowed(ctx: Ctx, acc: AccountRow) {
  if (acc.status !== 'open') throw new HttpError(400, 'Счёт закрыт', 'account_closed');
  if (!acc.user_id) return;
  const r = activeRestrictions(ctx, acc.user_id).find((x) => (x.type === 'block_debit' || x.type === 'block_full') && appliesTo(x, acc.id));
  if (r) throw new HttpError(403, `Операции по счёту ограничены: ${RESTRICTION_REASONS[r.reason] ?? r.reason}. Обратитесь в поддержку.`, 'account_restricted');
}

export function isFullyBlocked(ctx: Ctx, acc: AccountRow) {
  return !!acc.user_id && activeRestrictions(ctx, acc.user_id).some((x) => x.type === 'block_full' && appliesTo(x, acc.id));
}

export interface Leg {
  account: AccountRow;
  /** Signed amount in the account currency: negative = debit. */
  amount: number;
  title?: string;
  subtitle?: string;
  category?: Category;
  cardId?: string | null;
  /** Skip the available-balance check (bank-initiated: interest, penalties, loan accounts). */
  force?: boolean;
}

export interface PostInput {
  kind: string;
  description?: string;
  initiatorId?: string | null;
  meta?: object;
  legs: Leg[];
  /** A card hold this transaction settles: released atomically before the balance check. */
  holdId?: string;
}

/** Posts a balanced transaction. Every customer debit is checked against restrictions and available funds. */
export function post(ctx: Ctx, input: PostInput): string {
  const sums = new Map<string, number>();
  for (const l of input.legs) {
    if (!Number.isInteger(l.amount) || l.amount === 0) throw new Error('ledger: bad leg amount');
    sums.set(l.account.currency, (sums.get(l.account.currency) ?? 0) + l.amount);
  }
  for (const [cur, s] of sums) if (s !== 0) throw new Error(`ledger: unbalanced ${cur} (${s})`);

  const id = newId('trx', 20);
  const now = ctx.now();
  ctx.db.transaction(() => {
    if (input.holdId) ctx.db.prepare(`UPDATE holds SET status = 'captured' WHERE id = ? AND status = 'active'`).run(input.holdId);
    ctx.db
      .prepare('INSERT INTO transactions(id, kind, status, description, initiator_id, meta, created_at) VALUES(?,?,?,?,?,?,?)')
      .run(id, input.kind, 'completed', input.description ?? '', input.initiatorId ?? null, JSON.stringify(input.meta ?? {}), now);
    for (const l of input.legs) {
      const acc = getAccount(ctx, l.account.id)!;
      if (l.amount < 0 && acc.user_id && !l.force) {
        assertDebitAllowed(ctx, acc);
        if (acc.kind !== 'loan' && available(ctx, acc) + l.amount < 0) throw new HttpError(400, 'Недостаточно средств', 'insufficient_funds');
      }
      if (l.amount > 0 && acc.status !== 'open') throw new HttpError(400, 'Счёт получателя закрыт', 'account_closed');
      const after = acc.balance + l.amount;
      ctx.db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(after, acc.id);
      ctx.db
        .prepare('INSERT INTO entries(tx_id, account_id, amount, currency, balance_after, title, subtitle, category, card_id, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(id, acc.id, l.amount, acc.currency, after, l.title ?? input.description ?? '', l.subtitle ?? '', l.category ?? 'other', l.cardId ?? null, now);
    }
  })();
  return id;
}

/** Shorthand: move money from one account to another in the same currency. */
export function move(ctx: Ctx, from: AccountRow, to: AccountRow, amount: number, kind: string, sides: { from?: Partial<Leg>; to?: Partial<Leg>; description?: string; initiatorId?: string | null; meta?: object; holdId?: string } = {}) {
  return post(ctx, {
    kind,
    description: sides.description,
    initiatorId: sides.initiatorId,
    meta: sides.meta,
    holdId: sides.holdId,
    legs: [
      { ...sides.from, account: from, amount: -amount },
      { ...sides.to, account: to, amount },
    ],
  });
}

export function createHold(ctx: Ctx, acc: AccountRow, amount: number, title: string, category: Category, ttlMs: number, cardId: string | null): string {
  assertDebitAllowed(ctx, acc);
  if (available(ctx, acc) < amount) throw new HttpError(400, 'Недостаточно средств', 'insufficient_funds');
  const id = newId('hld', 16);
  const now = ctx.now();
  ctx.db.prepare('INSERT INTO holds(id, account_id, card_id, amount, title, category, status, expires_at, created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, acc.id, cardId, amount, title, category, 'active', now + ttlMs, now);
  return id;
}

export const releaseHold = (ctx: Ctx, id: string, status: 'released' | 'expired' = 'released') =>
  ctx.db.prepare(`UPDATE holds SET status = ? WHERE id = ? AND status = 'active'`).run(status, id).changes > 0;

export function notify(ctx: Ctx, userId: string, kind: string, title: string, body = '', data: object = {}) {
  ctx.db.prepare('INSERT INTO notifications(user_id, kind, title, body, data, created_at) VALUES(?,?,?,?,?,?)').run(userId, kind, title, body, JSON.stringify(data), ctx.now());
}

export function serializeAccount(ctx: Ctx, a: AccountRow) {
  return {
    id: a.id,
    number: a.number,
    kind: a.kind,
    currency: a.currency,
    name: a.name,
    balance: a.balance,
    creditLimit: a.credit_limit,
    available: available(ctx, a),
    held: heldAmount(ctx, a.id),
    arrested: arrestedAmount(ctx, a),
    status: a.status,
    params: safeJson<Record<string, unknown>>(a.params, {}),
    createdAt: a.created_at,
    bik: BANK.bik,
  };
}

export function userAccounts(ctx: Ctx, userId: string, includeClosed = false): AccountRow[] {
  return ctx.db.prepare(`SELECT * FROM accounts WHERE user_id = ? ${includeClosed ? '' : `AND status = 'open'`} ORDER BY created_at`).all(userId) as AccountRow[];
}

export function ownedAccount(ctx: Ctx, userId: string, id: string): AccountRow {
  const a = getAccount(ctx, id);
  if (!a || a.user_id !== userId) throw new HttpError(404, 'Счёт не найден');
  return a;
}

/** Main RUB current account of a customer: where salaries, refunds and transfers by phone land. */
export function mainAccount(ctx: Ctx, userId: string): AccountRow | undefined {
  return ctx.db.prepare(`SELECT * FROM accounts WHERE user_id = ? AND kind = 'current' AND currency = 'RUB' AND status = 'open' ORDER BY created_at LIMIT 1`).get(userId) as AccountRow | undefined;
}
