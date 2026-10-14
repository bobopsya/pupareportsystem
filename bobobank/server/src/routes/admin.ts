import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { audit, HttpError, type Ctx } from '../context.js';
import { RESTRICTION_REASONS, RESTRICTION_TYPES, type RestrictionReason } from '../domain/bank.js';
import { getCard, serializeCard, type CardRow } from '../domain/cards.js';
import { getApplication, getProducts, review, setProducts, type ApplicationRow, type LoanRow } from '../domain/credit.js';
import { getFx, setFx } from '../domain/fx.js';
import { getAccount, notify, post, serializeAccount, systemAccount, userAccounts, type AccountRow } from '../domain/ledger.js';
import { humanMoney, parseAmount } from '../domain/money.js';
import { systemMessage } from '../domain/support.js';
import { formatPhone, getUser, normalizePhone } from '../domain/transfers.js';
import { createUser } from '../domain/users.js';
import { newId, safeJson } from '../util.js';
import { restrictionView } from './client.js';

export function registerAdminRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  app.get('/api/admin/stats', async () => {
    const sum = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { s: number | null }).s ?? 0;
    const day = ctx.now() - 24 * 3600_000;
    return {
      clients: sum(`SELECT COUNT(*) s FROM users WHERE role = 'client'`),
      newClients: sum(`SELECT COUNT(*) s FROM users WHERE role = 'client' AND created_at >= ?`, day),
      deposits: sum(`SELECT SUM(balance) s FROM accounts WHERE user_id IS NOT NULL AND currency = 'RUB' AND kind IN ('current','savings','deposit','business','kids') AND balance > 0`),
      loansOut: sum(`SELECT -SUM(balance) s FROM accounts WHERE user_id IS NOT NULL AND currency = 'RUB' AND kind IN ('loan','credit_card') AND balance < 0`),
      overdue: sum(`SELECT COUNT(*) s FROM loans WHERE status = 'overdue'`),
      cards: sum(`SELECT COUNT(*) s FROM cards WHERE status != 'closed'`),
      turnover24h: sum(`SELECT SUM(-amount) s FROM entries e JOIN accounts a ON a.id = e.account_id WHERE a.user_id IS NOT NULL AND e.amount < 0 AND e.currency = 'RUB' AND e.created_at >= ?`, day),
      gpayBalance: -sum(`SELECT balance s FROM accounts WHERE system_code = 'gpay:RUB'`),
      fees: -(sum(`SELECT balance s FROM accounts WHERE system_code = 'fees:RUB'`) + sum(`SELECT balance s FROM accounts WHERE system_code = 'interest_income:RUB'`)),
      reviewApps: sum(`SELECT COUNT(*) s FROM applications WHERE status = 'review'`),
      openThreads: sum(`SELECT COUNT(*) s FROM support_threads WHERE status = 'open'`),
      restrictions: sum(`SELECT COUNT(*) s FROM restrictions WHERE lifted_at IS NULL`),
      system: (db.prepare(`SELECT name, currency, balance FROM accounts WHERE user_id IS NULL ORDER BY system_code`).all() as { name: string; currency: string; balance: number }[]),
    };
  });

  app.get('/api/admin/users', async (req) => {
    const q = z.object({ q: z.string().max(60).optional(), role: z.string().optional() }).parse(req.query);
    const where: string[] = [];
    const args: unknown[] = [];
    if (q.q) {
      const phone = normalizePhone(q.q);
      where.push('(u.name LIKE ? OR u.phone LIKE ? OR u.id = ? OR EXISTS (SELECT 1 FROM accounts a WHERE a.user_id = u.id AND a.number LIKE ?) OR EXISTS (SELECT 1 FROM cards c WHERE c.user_id = u.id AND c.last4 = ?))');
      args.push(`%${q.q}%`, `%${phone ?? q.q.replace(/\D/g, '') ?? q.q}%`, q.q, `%${q.q}%`, q.q);
    }
    if (q.role) (where.push('u.role = ?'), args.push(q.role));
    const rows = db
      .prepare(
        `SELECT u.id, u.name, u.phone, u.role, u.tariff, u.blocked, u.created_at,
           (SELECT COALESCE(SUM(balance), 0) FROM accounts a WHERE a.user_id = u.id AND a.currency = 'RUB' AND a.kind IN ('current','savings','deposit','business','kids')) rub,
           (SELECT COUNT(*) FROM restrictions r WHERE r.user_id = u.id AND r.lifted_at IS NULL) restricted
         FROM users u ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY u.created_at DESC LIMIT 200`,
      )
      .all(...args) as { phone: string }[];
    return { items: rows.map((r) => ({ ...r, phone: formatPhone(r.phone) })) };
  });

  app.get('/api/admin/users/:id', async (req) => {
    const user = getUser(ctx, (req.params as { id: string }).id);
    if (!user) throw new HttpError(404, 'Клиент не найден');
    const full = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as { birth_date: string; bonus: number; block_reason: string | null; created_at: number; tariff_paid_until: number | null };
    const entries = db
      .prepare(`SELECT e.id, e.amount, e.currency, e.title, e.subtitle, e.category, e.created_at createdAt, a.name accountName, t.kind FROM entries e JOIN accounts a ON a.id = e.account_id JOIN transactions t ON t.id = e.tx_id WHERE a.user_id = ? ORDER BY e.id DESC LIMIT 100`)
      .all(user.id);
    const all = (db.prepare('SELECT * FROM restrictions WHERE user_id = ? ORDER BY created_at DESC').all(user.id) as { reason: RestrictionReason; type: keyof typeof RESTRICTION_TYPES }[]).map((r) => ({ ...r, reasonTitle: RESTRICTION_REASONS[r.reason], typeTitle: RESTRICTION_TYPES[r.type] }));
    return {
      user: { ...user, phone: formatPhone(user.phone), birthDate: full.birth_date, bonus: full.bonus, blockReason: full.block_reason, createdAt: full.created_at, tariffPaidUntil: full.tariff_paid_until },
      accounts: userAccounts(ctx, user.id, true).map((a) => serializeAccount(ctx, a)),
      cards: (db.prepare('SELECT * FROM cards WHERE user_id = ? ORDER BY created_at').all(user.id) as CardRow[]).map((c) => serializeCard(ctx, c)),
      restrictions: all,
      active: restrictionView(ctx, user.id),
      loans: db.prepare('SELECT id, principal, rate, term, payment, penalty, status, created_at createdAt FROM loans WHERE user_id = ? ORDER BY created_at DESC').all(user.id) as LoanRow[],
      applications: db.prepare('SELECT * FROM applications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(user.id),
      entries,
    };
  });

  app.post('/api/admin/users', async (req) => {
    const b = z.object({ phone: z.string(), name: z.string().trim().min(2).max(80), password: z.string().min(8).max(200), role: z.enum(['client', 'support', 'admin']) }).parse(req.body);
    const phone = normalizePhone(b.phone);
    if (!phone) throw new HttpError(400, 'Некорректный телефон');
    const id = await createUser(ctx, phone, b.name, b.password, { role: b.role });
    audit(ctx, req, 'user_create', 'user', id, `${b.role} ${phone}`);
    return { id };
  });

  app.post('/api/admin/users/:id/block', async (req) => {
    const user = getUser(ctx, (req.params as { id: string }).id);
    if (!user) throw new HttpError(404, 'Клиент не найден');
    const b = z.object({ blocked: z.boolean(), reason: z.string().trim().max(200).optional() }).parse(req.body);
    if (user.id === requireUser(req).id) throw new HttpError(400, 'Нельзя заблокировать себя');
    db.prepare('UPDATE users SET blocked = ?, block_reason = ? WHERE id = ?').run(b.blocked ? 1 : 0, b.blocked ? b.reason ?? null : null, user.id);
    if (b.blocked) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    audit(ctx, req, b.blocked ? 'user_block' : 'user_unblock', 'user', user.id, b.reason ?? null);
    return { ok: true };
  });

  app.post('/api/admin/users/:id/role', async (req) => {
    const user = getUser(ctx, (req.params as { id: string }).id);
    if (!user) throw new HttpError(404, 'Пользователь не найден');
    const { role } = z.object({ role: z.enum(['client', 'support', 'admin']) }).parse(req.body);
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
    audit(ctx, req, 'user_role', 'user', user.id, role);
    return { ok: true };
  });

  // Manual credit/debit by the bank (salary, prize, correction).
  app.post('/api/admin/accounts/:id/adjust', async (req) => {
    const acc = getAccount(ctx, (req.params as { id: string }).id);
    if (!acc || !acc.user_id) throw new HttpError(404, 'Счёт не найден');
    const b = z.object({ direction: z.enum(['credit', 'debit']), amount: z.union([z.string(), z.number()]), title: z.string().trim().min(2).max(80), comment: z.string().trim().max(200).default(''), force: z.boolean().default(false) }).parse(req.body);
    const amount = parseAmount(b.amount);
    const cap = systemAccount(ctx, 'capital', acc.currency);
    const credit = b.direction === 'credit';
    const txId = post(ctx, {
      kind: credit ? 'admin_credit' : 'admin_debit',
      description: b.title,
      initiatorId: requireUser(req).id,
      meta: { comment: b.comment },
      legs: [
        { account: credit ? cap : acc, amount: -amount, ...(credit ? {} : { title: b.title, subtitle: b.comment || 'Списание банком', category: 'fees' as const, force: b.force }) },
        { account: credit ? acc : cap, amount, ...(credit ? { title: b.title, subtitle: b.comment || 'Зачисление', category: 'income' as const } : {}) },
      ],
    });
    notify(ctx, acc.user_id, credit ? 'income' : 'debit', `${credit ? '+' : '−'}${humanMoney(amount, acc.currency)}`, `${b.title}${b.comment ? ` · ${b.comment}` : ''}`);
    audit(ctx, req, b.direction === 'credit' ? 'admin_credit' : 'admin_debit', 'account', acc.id, `${humanMoney(amount, acc.currency)} ${b.title}`);
    return { txId };
  });

  app.post('/api/admin/accounts/:id/limit', async (req) => {
    const acc = getAccount(ctx, (req.params as { id: string }).id);
    if (!acc || acc.kind !== 'credit_card') throw new HttpError(400, 'Лимит меняется только у кредитной карты');
    const { limit } = z.object({ limit: z.union([z.string(), z.number()]) }).parse(req.body);
    const v = parseAmount(limit);
    if (acc.balance < -v) throw new HttpError(400, 'Новый лимит меньше текущей задолженности');
    db.prepare('UPDATE accounts SET credit_limit = ? WHERE id = ?').run(v, acc.id);
    notify(ctx, acc.user_id!, 'credit', 'Кредитный лимит изменён', `Новый лимит — ${humanMoney(v, 'RUB')}`);
    audit(ctx, req, 'credit_limit', 'account', acc.id, humanMoney(v, 'RUB'));
    return { ok: true };
  });

  // ---------- Arrests and blocks ----------
  app.post('/api/admin/restrictions', async (req) => {
    const b = z
      .object({
        userId: z.string(),
        accountId: z.string().nullable().optional(),
        type: z.enum(['arrest', 'block_debit', 'block_full']),
        amount: z.union([z.string(), z.number()]).optional(),
        reason: z.enum(Object.keys(RESTRICTION_REASONS) as [RestrictionReason, ...RestrictionReason[]]),
        comment: z.string().trim().max(300).default(''),
      })
      .parse(req.body);
    const user = getUser(ctx, b.userId);
    if (!user) throw new HttpError(404, 'Клиент не найден');
    let acc: AccountRow | undefined;
    if (b.accountId) {
      acc = getAccount(ctx, b.accountId);
      if (!acc || acc.user_id !== user.id) throw new HttpError(400, 'Счёт не принадлежит клиенту');
    }
    if (b.type === 'arrest' && !acc) throw new HttpError(400, 'Для ареста укажите счёт');
    const amount = b.type === 'arrest' ? parseAmount(b.amount ?? '') : 0;
    const id = newId('rst', 12);
    db.prepare('INSERT INTO restrictions(id, user_id, account_id, type, amount, reason, comment, created_by, created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, user.id, acc?.id ?? null, b.type, amount, b.reason, b.comment, requireUser(req).id, ctx.now());
    if (b.type === 'block_full') db.prepare(`UPDATE cards SET status = 'blocked', status_reason = ? WHERE user_id = ? AND status IN ('active','frozen') ${acc ? 'AND account_id = ?' : ''}`).run(RESTRICTION_REASONS[b.reason], user.id, ...(acc ? [acc.id] : []));
    const where = acc ? `по счёту •• ${acc.number.slice(-4)}` : 'по всем счетам';
    const what = b.type === 'arrest' ? `наложен арест на ${humanMoney(amount, acc!.currency)}` : b.type === 'block_debit' ? 'приостановлены списания' : 'приостановлены все операции, карты заблокированы';
    const text = `${what[0].toUpperCase()}${what.slice(1)} ${where}. Основание: ${RESTRICTION_REASONS[b.reason]}.${b.comment ? ` ${b.comment}` : ''}`;
    notify(ctx, user.id, 'restriction', RESTRICTION_TYPES[b.type], text);
    systemMessage(ctx, user.id, `${text}\n\nЕсли у вас есть вопросы или документы об отмене — напишите в этот чат.`, RESTRICTION_TYPES[b.type]);
    audit(ctx, req, 'restriction_add', 'user', user.id, `${b.type} ${b.reason} ${amount ? humanMoney(amount, acc!.currency) : ''} ${b.comment}`);
    return { id };
  });

  app.post('/api/admin/restrictions/:id/lift', async (req) => {
    const r = db.prepare('SELECT * FROM restrictions WHERE id = ?').get((req.params as { id: string }).id) as { id: string; user_id: string; account_id: string | null; type: string; lifted_at: number | null } | undefined;
    if (!r || r.lifted_at) throw new HttpError(404, 'Ограничение не найдено или уже снято');
    const { comment } = z.object({ comment: z.string().trim().max(300).default('') }).parse(req.body ?? {});
    db.prepare('UPDATE restrictions SET lifted_at = ?, lifted_by = ?, lift_comment = ? WHERE id = ?').run(ctx.now(), requireUser(req).id, comment, r.id);
    if (r.type === 'block_full') {
      const still = db.prepare(`SELECT 1 FROM restrictions WHERE user_id = ? AND type = 'block_full' AND lifted_at IS NULL`).get(r.user_id);
      if (!still) db.prepare(`UPDATE cards SET status = 'active', status_reason = NULL WHERE user_id = ? AND status = 'blocked'`).run(r.user_id);
    }
    notify(ctx, r.user_id, 'restriction', 'Ограничение снято', comment || 'Операции по счёту доступны в обычном режиме.');
    systemMessage(ctx, r.user_id, `Ограничение снято.${comment ? ` ${comment}` : ''}`);
    audit(ctx, req, 'restriction_lift', 'user', r.user_id, comment);
    return { ok: true };
  });

  app.get('/api/admin/restrictions', async () => {
    const rows = db
      .prepare(`SELECT r.*, u.name user_name, a.number account_number FROM restrictions r JOIN users u ON u.id = r.user_id LEFT JOIN accounts a ON a.id = r.account_id WHERE r.lifted_at IS NULL ORDER BY r.created_at DESC`)
      .all() as { reason: RestrictionReason; type: keyof typeof RESTRICTION_TYPES }[];
    return { items: rows.map((r) => ({ ...r, reasonTitle: RESTRICTION_REASONS[r.reason], typeTitle: RESTRICTION_TYPES[r.type] })), reasons: RESTRICTION_REASONS, types: RESTRICTION_TYPES };
  });

  app.post('/api/admin/cards/:id/status', async (req) => {
    const c = getCard(ctx, (req.params as { id: string }).id);
    if (!c) throw new HttpError(404, 'Карта не найдена');
    const b = z.object({ status: z.enum(['active', 'blocked']), reason: z.string().trim().max(200).optional() }).parse(req.body);
    if (c.status === 'closed') throw new HttpError(400, 'Карта закрыта');
    db.prepare('UPDATE cards SET status = ?, status_reason = ? WHERE id = ?').run(b.status, b.status === 'blocked' ? b.reason ?? 'Решение банка' : null, c.id);
    notify(ctx, c.user_id, 'card', b.status === 'blocked' ? `Карта •• ${c.last4} заблокирована` : `Карта •• ${c.last4} разблокирована`, b.reason ?? '');
    audit(ctx, req, b.status === 'blocked' ? 'card_block' : 'card_unblock', 'card', c.id, b.reason ?? null);
    return { ok: true };
  });

  // ---------- Credit applications ----------
  app.get('/api/admin/applications', async (req) => {
    const { status } = z.object({ status: z.string().default('review') }).parse(req.query);
    const rows = db
      .prepare(`SELECT ap.*, u.name user_name, u.phone user_phone FROM applications ap JOIN users u ON u.id = ap.user_id ${status === 'all' ? '' : 'WHERE ap.status = ?'} ORDER BY ap.created_at DESC LIMIT 100`)
      .all(...(status === 'all' ? [] : [status])) as (ApplicationRow & { user_name: string; user_phone: string })[];
    return { items: rows.map((r) => ({ ...r, factors: safeJson(r.factors, {}), user_phone: formatPhone(r.user_phone) })) };
  });

  app.post('/api/admin/applications/:id/review', async (req) => {
    const a = getApplication(ctx, (req.params as { id: string }).id);
    if (!a) throw new HttpError(404, 'Заявка не найдена');
    const b = z.object({ approve: z.boolean(), amount: z.union([z.string(), z.number()]).optional(), rate: z.number().min(0).max(100).optional(), reason: z.string().trim().max(300).optional() }).parse(req.body);
    review(ctx, a, requireUser(req).id, b.approve, b.amount !== undefined ? parseAmount(b.amount) : undefined, b.rate, b.reason);
    audit(ctx, req, b.approve ? 'credit_approve' : 'credit_reject', 'application', a.id, b.reason ?? null);
    return { ok: true };
  });

  // ---------- Settings ----------
  app.get('/api/admin/settings', async () => ({ fx: getFx(db), products: getProducts(db) }));

  app.post('/api/admin/settings', async (req) => {
    const b = z
      .object({
        fx: z.object({ USD: z.number().positive(), EUR: z.number().positive(), spread: z.number().min(0).max(20) }).optional(),
        products: z
          .object({
            savingsRate: z.number().min(0).max(50),
            deposits: z.array(z.object({ months: z.number().int().min(1).max(60), rate: z.number().min(0).max(50) })).min(1).max(8),
            loanRate: z.number().min(0).max(100),
            loanMin: z.number().int().positive(),
            loanMax: z.number().int().positive(),
            creditCardRate: z.number().min(0).max(100),
            creditCardGraceDays: z.number().int().min(0).max(365),
            creditCardMax: z.number().int().positive(),
            minPaymentPct: z.number().min(1).max(50),
            latePenalty: z.number().int().min(0),
            scoreApprove: z.number().int().min(300).max(900),
            scoreReject: z.number().int().min(300).max(900),
          })
          .optional(),
      })
      .parse(req.body);
    if (b.fx) setFx(db, b.fx, ctx.now());
    if (b.products) setProducts(db, b.products);
    audit(ctx, req, 'settings', null, null, JSON.stringify(b).slice(0, 400));
    return { fx: getFx(db), products: getProducts(db) };
  });

  app.get('/api/admin/transactions', async (req) => {
    const { kind } = z.object({ kind: z.string().optional() }).parse(req.query);
    const rows = db
      .prepare(`SELECT t.id, t.kind, t.description, t.created_at createdAt, t.meta FROM transactions t ${kind ? 'WHERE t.kind = ?' : ''} ORDER BY t.created_at DESC LIMIT 150`)
      .all(...(kind ? [kind] : [])) as { id: string; meta: string }[];
    const legs = db.prepare(`SELECT e.amount, e.currency, a.name, a.number, a.user_id, u.name user_name FROM entries e JOIN accounts a ON a.id = e.account_id LEFT JOIN users u ON u.id = a.user_id WHERE e.tx_id = ? ORDER BY e.id`);
    return { items: rows.map((r) => ({ ...r, meta: safeJson(r.meta, {}), legs: legs.all(r.id) })) };
  });

  app.get('/api/admin/audit', async () => ({ items: db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 300').all() }));
}
