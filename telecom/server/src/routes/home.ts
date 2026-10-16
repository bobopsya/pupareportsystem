import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import type { Ctx } from '../context.js';
import { cancelHome, changeHomeTariff, coverage, homeOffer, homeView, openHome, orderHome, payHomeNow, slots, speedtest } from '../domain/home.js';

const address = z.object({ street: z.string().trim().max(120), house: z.string().trim().max(20), flat: z.string().trim().max(10).default('') });

export function registerHomeRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/home/offer', async (req) => homeOffer(ctx, req.user?.id ?? null));
  app.post('/api/home/coverage', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => coverage(address.parse(req.body)));
  app.get('/api/home/slots', async () => ({ slots: slots(ctx) }));

  app.get('/api/home', async (req) => {
    const h = openHome(ctx, requireUser(req).id);
    return { home: h ? homeView(ctx, h) : null };
  });
  app.post('/api/home', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ tariff: z.string().max(20), address, router: z.enum(['own', 'rent', 'buy']), installAt: z.number().int() }).parse(req.body);
    return homeView(ctx, await orderHome(ctx, requireUser(req), b));
  });
  app.post('/api/home/tariff', async (req) => {
    const b = z.object({ tariff: z.string().max(20) }).parse(req.body);
    return homeView(ctx, changeHomeTariff(ctx, requireUser(req), b.tariff));
  });
  app.post('/api/home/pay', async (req) => homeView(ctx, await payHomeNow(ctx, requireUser(req))));
  app.post('/api/home/cancel', async (req) => {
    await cancelHome(ctx, requireUser(req));
    return { ok: true };
  });
  app.get('/api/home/speedtest', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => speedtest(ctx, requireUser(req)));
}
