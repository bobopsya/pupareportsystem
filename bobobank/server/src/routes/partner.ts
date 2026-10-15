import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { HttpError, type Ctx } from '../context.js';
import {
  captureCharge, chargeNow, decideConfirmation, grantMandate, holdCharge, mandateInfo, partnerCharge, partnerConfirmation, partnerMandate, partners, pendingPartnerRequests, redeemCode, refundCharge,
  requestConfirmation, revokeMandate, updateMandate, userConfirmation, userMandates, voidCharge,
  type ChargeRow,
} from '../domain/partners.js';
import { SIGNATURE_HEADER, verify } from '../domain/signing.js';
import { makeIdempotent } from './internal.js';

const minor = z.number().int().positive().max(10_000_000_00);
const PREFIX = '/internal/partner/v1/';
export const PARTNER_HEADER = 'x-partner-client';

const chargeView = (c: ChargeRow) => ({ id: c.id, status: c.status, amount: c.amount, captured: c.captured, refunded: c.refunded, external_id: c.external_id });

/**
 * «Войти через Bobobank» for partner services (Бобо.Транспорт): the consent page API for the customer
 * and the HMAC-signed server API for the partner. Each partner signs with its own secret.
 */
export function registerPartnerRoutes(app: FastifyInstance, ctx: Ctx) {
  const idempotent = makeIdempotent(ctx);

  // ---- Customer side (bank app) ----
  app.get('/api/partners/:client', async (req) => {
    const p = partners(ctx)[(req.params as { client: string }).client];
    if (!p) throw new HttpError(404, 'Сервис не подключён к Bobobank');
    return { client: p.client, name: p.name, scope: p.scope, limit: p.limit, maxLimit: p.maxLimit };
  });

  app.post('/api/partners/:client/authorize', async (req) => {
    const u = requireUser(req);
    const b = z.object({ accountId: z.string().max(64), limit: z.number().int().positive().optional(), state: z.string().max(200).default('') }).parse(req.body);
    const r = grantMandate(ctx, u.id, (req.params as { client: string }).client, b.accountId, b.limit, b.state);
    return { redirect: r.redirect };
  });

  app.get('/api/mandates', async (req) => ({ mandates: userMandates(ctx, requireUser(req).id) }));

  app.patch('/api/mandates/:id', async (req) => {
    const b = z.object({ accountId: z.string().max(64).optional(), limit: z.number().int().positive().optional() }).parse(req.body);
    updateMandate(ctx, requireUser(req).id, (req.params as { id: string }).id, b);
    return { ok: true };
  });

  app.get('/api/partner-requests', async (req) => ({ requests: pendingPartnerRequests(ctx, requireUser(req).id) }));
  app.get('/api/partner-requests/:id', async (req) => userConfirmation(ctx, requireUser(req).id, (req.params as { id: string }).id));
  app.post('/api/partner-requests/:id', async (req) => {
    const { approve } = z.object({ approve: z.boolean() }).parse(req.body);
    return decideConfirmation(ctx, requireUser(req).id, (req.params as { id: string }).id, approve);
  });

  app.delete('/api/mandates/:id', async (req) => {
    revokeMandate(ctx, requireUser(req).id, (req.params as { id: string }).id);
    return { ok: true };
  });

  // ---- Partner side (server to server) ----
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith(PREFIX)) return;
    const p = partners(ctx)[String(req.headers[PARTNER_HEADER] ?? '')];
    const path = req.url.split('?')[0];
    if (!p || !verify(p.secret, req.headers[SIGNATURE_HEADER] as string | undefined, req.method, path, req.rawBody ?? '', Math.floor(ctx.now() / 1000))) {
      return reply.code(401).send({ error: 'Неверная подпись запроса' });
    }
  });
  const client = (req: FastifyRequest) => String(req.headers[PARTNER_HEADER]);
  const id = (req: FastifyRequest) => (req.params as { id: string }).id;

  app.post(`${PREFIX}auth/redeem`, async (req) => {
    const { code } = z.object({ code: z.string().min(10).max(100) }).parse(req.body);
    return redeemCode(ctx, client(req), code);
  });

  app.get(`${PREFIX}mandates/:id`, async (req) => mandateInfo(ctx, partnerMandate(ctx, client(req), id(req))));

  const holdBody = z.object({ amount: z.number().int().positive().max(50_000_000_00), external_id: z.string().min(1).max(64), title: z.string().max(200).default(''), subtitle: z.string().max(200).default(''), allow_confirmation: z.boolean().default(false) });
  // Above the mandate limit the partner may ask for a confirmation in the app instead of a refusal.
  app.post(`${PREFIX}mandates/:id/holds`, idempotent((req) => {
    const b = holdBody.parse(req.body);
    const m = partnerMandate(ctx, client(req), id(req));
    const done = ctx.db.prepare('SELECT 1 FROM partner_charges WHERE mandate_id = ? AND external_id = ?').get(m.id, b.external_id);
    if (b.allow_confirmation && !done && b.amount > m.limit_per_tx) return { status: 'confirmation_required', confirmation: requestConfirmation(ctx, client(req), m.id, b.amount, b.external_id, b.title) };
    if (b.amount > 10_000_000_00) throw new HttpError(402, 'Сумма слишком большая', 'limit_exceeded');
    return chargeView(holdCharge(ctx, client(req), id(req), b.amount, b.external_id, b.title));
  }));

  app.get(`${PREFIX}confirmations/:id`, async (req) => partnerConfirmation(ctx, client(req), id(req)));

  app.post(`${PREFIX}mandates/:id/charges`, idempotent((req) => {
    const b = holdBody.parse(req.body);
    if (b.amount > 10_000_000_00) throw new HttpError(402, 'Сумма слишком большая', 'limit_exceeded');
    return chargeView(chargeNow(ctx, client(req), id(req), b.amount, b.external_id, b.title, b.subtitle));
  }));

  app.get(`${PREFIX}holds/:id`, async (req) => chargeView(partnerCharge(ctx, client(req), id(req)).c));

  app.post(`${PREFIX}holds/:id/capture`, idempotent((req) => {
    const b = z.object({ amount: z.number().int().min(0).max(10_000_000_00), title: z.string().max(200).default(''), subtitle: z.string().max(200).default('') }).parse(req.body);
    return chargeView(captureCharge(ctx, client(req), id(req), b.amount, b.title, b.subtitle));
  }));

  app.post(`${PREFIX}holds/:id/void`, idempotent((req) => chargeView(voidCharge(ctx, client(req), id(req)))));

  app.post(`${PREFIX}charges/:id/refund`, idempotent((req) => {
    const { amount } = z.object({ amount: minor }).parse(req.body);
    return chargeView(refundCharge(ctx, client(req), id(req), amount));
  }));
}
