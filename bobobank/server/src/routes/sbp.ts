import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { audit, type Ctx } from '../context.js';
import { ownedAccount } from '../domain/ledger.js';
import { checkoutUrl, decideRequest, loadOrder, payOrder } from '../domain/orders.js';

/** GPAY orders paid from the app: SBP QR code, the Bobo Pay button, and Bobo Pay requests sent to the phone. */
export function registerSbpRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/sbp/:id', async (req) => {
    requireUser(req);
    const id = (req.params as { id: string }).id;
    return { payment: await loadOrder(ctx, id), checkoutUrl: checkoutUrl(ctx, id) };
  });

  app.post('/api/sbp/:id/pay', async (req) => {
    const u = requireUser(req);
    const { accountId, method } = z.object({ accountId: z.string(), method: z.enum(['sbp', 'bobopay']).default('sbp') }).parse(req.body);
    const id = (req.params as { id: string }).id;
    const r = await payOrder(ctx, u.id, ownedAccount(ctx, u.id, accountId), id, method);
    audit(ctx, req, method === 'sbp' ? 'sbp_pay' : 'bobopay', 'payment', id);
    return { ok: true, ...r };
  });

  app.post('/api/requests/:id', async (req) => {
    const u = requireUser(req);
    const b = z.object({ approve: z.boolean(), accountId: z.string().optional() }).parse(req.body);
    const id = (req.params as { id: string }).id;
    const r = decideRequest(ctx, u.id, id, b.approve, b.accountId);
    audit(ctx, req, b.approve ? 'bobopay_approve' : 'bobopay_decline', 'request', id);
    return r;
  });
}
