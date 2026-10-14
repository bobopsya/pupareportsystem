import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError, type Ctx } from '../context.js';
import { sbpInfo, sbpPaidByBank } from '../domain/bankpay.js';
import { loadPayment } from '../domain/payments.js';
import { SIGNATURE_HEADER, verify } from '../domain/signing.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

/** Endpoints for Bobobank only (internal docker network, HMAC-signed): SBP payments made in the bank app. */
export function registerBankInternalRoutes(app: FastifyInstance, ctx: Ctx) {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/internal/')) return;
    if (!ctx.cfg.bankSecret) return reply.code(503).send({ error: 'Интеграция с Bobobank не настроена' });
    const path = req.url.split('?')[0];
    if (!verify(ctx.cfg.bankSecret, req.headers[SIGNATURE_HEADER] as string | undefined, req.method, path, req.rawBody ?? '', Math.floor(ctx.now() / 1000))) {
      return reply.code(401).send({ error: 'Неверная подпись запроса' });
    }
  });

  const payment = (id: string) => {
    const p = loadPayment(ctx, id);
    if (!p) throw new ApiError(404, 'not_found', 'Платёж не найден');
    return p;
  };

  app.get<{ Params: { id: string } }>('/internal/bank/payments/:id', async (req) => sbpInfo(ctx, payment(req.params.id)));

  app.post<{ Params: { id: string } }>('/internal/bank/payments/:id/sbp', async (req) => {
    const b = z.object({ operation_id: z.string().max(40), payer: z.object({ name: z.string().max(80).optional(), phone: z.string().max(30).optional() }).optional() }).parse(req.body);
    const p = sbpPaidByBank(ctx, payment(req.params.id), { operationId: b.operation_id, payer: b.payer });
    return { status: p.status };
  });
}
