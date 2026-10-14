import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { audit, HttpError, type Ctx } from '../context.js';
import { categoryOfMcc } from '../domain/bank.js';
import { gpayRequest } from '../domain/gpay.js';
import { notify, ownedAccount, post, systemAccount } from '../domain/ledger.js';
import { humanMoney } from '../domain/money.js';
import { formatPhone, getUser, shortName } from '../domain/transfers.js';
import { newId, randomString } from '../util.js';

interface GpayPayment {
  id: string;
  status: string;
  amount: number;
  currency: string;
  description: string;
  merchant: { name: string; inn?: string; mcc?: number; shop_id: number; site?: string };
  sbp: boolean;
  return_url?: string | null;
}

/** Paying a GPAY order through SBP from the bank app: the customer confirms, the bank pays GPAY. */
export function registerSbpRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;
  const load = async (id: string) => {
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw new HttpError(404, 'Платёж не найден');
    return gpayRequest<GpayPayment>(ctx, 'GET', `/internal/bank/payments/${id}`);
  };

  app.get('/api/sbp/:id', async (req) => {
    requireUser(req);
    const p = await load((req.params as { id: string }).id);
    return { payment: p };
  });

  app.post('/api/sbp/:id/pay', async (req) => {
    const u = requireUser(req);
    const { accountId } = z.object({ accountId: z.string() }).parse(req.body);
    const p = await load((req.params as { id: string }).id);
    if (p.status !== 'pending') throw new HttpError(400, p.status === 'succeeded' ? 'Этот заказ уже оплачен' : 'Платёж больше нельзя оплатить');
    if (!p.sbp) throw new HttpError(400, 'Магазин не принимает оплату через СБП');
    const acc = ownedAccount(ctx, u.id, accountId);
    if (acc.currency !== p.currency) throw new HttpError(400, `Оплата СБП — со счёта в ${p.currency}`);
    if (!['current', 'savings', 'business', 'credit_card', 'kids'].includes(acc.kind)) throw new HttpError(400, 'С этого счёта нельзя платить');
    if (db.prepare(`SELECT 1 FROM sbp_payments WHERE external_id = ? AND status = 'succeeded'`).get(p.id)) throw new HttpError(400, 'Этот заказ уже оплачен');
    const opId = `B${randomString(19, '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ')}`;
    const category = categoryOfMcc(p.merchant.mcc);
    const txId = post(ctx, {
      kind: 'sbp_payment',
      description: `Оплата СБП: ${p.merchant.name}`,
      initiatorId: u.id,
      meta: { paymentId: p.id, operationId: opId, merchant: { name: p.merchant.name, inn: p.merchant.inn } },
      legs: [
        { account: acc, amount: -p.amount, title: p.merchant.name, subtitle: 'Оплата по QR-коду СБП', category },
        { account: systemAccount(ctx, 'gpay', p.currency), amount: p.amount },
      ],
    });
    const id = newId('sbp', 16);
    db.prepare('INSERT INTO sbp_payments(id, external_id, user_id, account_id, amount, currency, merchant, status, tx_id, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, p.id, u.id, acc.id, p.amount, p.currency, JSON.stringify(p.merchant), 'processing', txId, ctx.now());
    const user = getUser(ctx, u.id)!;
    try {
      await gpayRequest(ctx, 'POST', `/internal/bank/payments/${p.id}/sbp`, { operation_id: opId, payer: { name: shortName(user.name), phone: formatPhone(user.phone).replace(/\d{2}-\d{2}$/, '**-**') } });
    } catch (e) {
      // GPAY refused or is down: give the money back right away.
      post(ctx, {
        kind: 'sbp_reversal',
        description: `Отмена оплаты СБП: ${p.merchant.name}`,
        meta: { paymentId: p.id, operationId: opId },
        legs: [
          { account: systemAccount(ctx, 'gpay', p.currency), amount: -p.amount },
          { account: acc, amount: p.amount, title: p.merchant.name, subtitle: 'Отмена оплаты СБП', category },
        ],
      });
      db.prepare(`UPDATE sbp_payments SET status = 'failed' WHERE id = ?`).run(id);
      throw e;
    }
    db.prepare(`UPDATE sbp_payments SET status = 'succeeded' WHERE id = ?`).run(id);
    notify(ctx, u.id, 'purchase', `−${humanMoney(p.amount, p.currency)}`, `${p.merchant.name} · СБП`);
    audit(ctx, req, 'sbp_pay', 'payment', p.id, humanMoney(p.amount, p.currency));
    const entry = db.prepare('SELECT id FROM entries WHERE tx_id = ? AND account_id = ?').get(txId, acc.id) as { id: number };
    return { ok: true, entryId: entry.id, returnUrl: p.return_url ?? null };
  });
}
