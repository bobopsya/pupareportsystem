import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { cancel, getRide, historyItem, settle, type RideRow } from '../domain/rides.js';
import { getSettings, saveSettings, surgeAt, TARIFF_IDS } from '../domain/tariffs.js';
import { HttpError } from '../context.js';

const tariffSchema = z.object({
  id: z.enum(TARIFF_IDS),
  title: z.string().min(1).max(40),
  base: z.number().min(0).max(100_000),
  perKm: z.number().min(0).max(10_000),
  perMin: z.number().min(0).max(10_000),
  min: z.number().min(0).max(100_000),
  waitPerMin: z.number().min(0).max(10_000),
  seats: z.number().int().min(1).max(8),
  cars: z.array(z.string().min(1).max(60)).min(1).max(10),
  etaMin: z.tuple([z.number().int().min(1).max(60), z.number().int().min(1).max(60)]),
  vehicle: z.enum(['car', 'bus']).optional(),
});

const airSchema = z.object({
  id: z.string().min(1).max(32),
  title: z.string().min(1).max(40),
  model: z.string().min(1).max(60),
  seats: z.number().int().min(1).max(30),
  rate: z.number().min(0).max(100_000_000),
  speed: z.number().min(50).max(1200),
  range: z.number().min(10).max(20_000),
});

export function registerAdminRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  app.get('/api/admin/overview', async () => {
    const day = ctx.now() - 24 * 3600_000;
    const q = (sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) as Record<string, number>;
    return {
      users: q('SELECT COUNT(*) n FROM users').n,
      active: q(`SELECT COUNT(*) n FROM rides WHERE status IN ('searching','driver_coming','arrived','in_ride')`).n,
      today: q(`SELECT COUNT(*) n, COALESCE(SUM(final_price), 0) s FROM rides WHERE status = 'completed' AND finished_at > ?`, day),
      total: q(`SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN bank_status = 'captured' THEN final_price ELSE 0 END), 0) s, COALESCE(SUM(tip), 0) tips FROM rides WHERE status IN ('completed','cancelled')`),
      failed: q(`SELECT COUNT(*) n FROM rides WHERE bank_status = 'failed'`).n,
      surgeNow: surgeAt(ctx),
    };
  });

  app.get('/api/admin/rides', async (req) => {
    const { status } = z.object({ status: z.string().max(20).optional() }).parse(req.query);
    const rows = db
      .prepare(`SELECT r.*, u.name user_name FROM rides r JOIN users u ON u.id = r.user_id ${status ? 'WHERE r.status = ?' : ''} ORDER BY r.created_at DESC LIMIT 100`)
      .all(...(status ? [status] : [])) as (RideRow & { user_name: string })[];
    return { rides: rows.map((r) => ({ ...historyItem(ctx, r), user: r.user_name, bankError: r.bank_error })) };
  });

  app.post('/api/admin/rides/:id/cancel', async (req) => {
    const r = getRide(ctx, (req.params as { id: string }).id);
    if (!r) throw new HttpError(404, 'Поездка не найдена');
    if (r.status === 'in_ride') db.prepare(`UPDATE rides SET status = 'arrived' WHERE id = ?`).run(r.id);
    cancel(ctx, getRide(ctx, r.id)!, 'admin');
    await settle(ctx, getRide(ctx, r.id)!);
    return { ok: true };
  });

  app.get('/api/admin/settings', async () => getSettings(ctx));

  app.put('/api/admin/settings', async (req) => {
    const b = z
      .object({
        timeScale: z.number().min(1).max(60).optional(),
        surgeMode: z.enum(['auto', 'fixed']).optional(),
        surgeFixed: z.number().min(1).max(3).optional(),
        freeWaitMin: z.number().int().min(0).max(30).optional(),
        autoBoardMin: z.number().min(1).max(60).optional(),
        heliPrepMin: z.number().min(0).max(240).optional(),
        jetPrepMin: z.number().min(0).max(240).optional(),
        airBoardMin: z.number().min(1).max(120).optional(),
        cancelFee: z.number().int().min(0).max(10_000).optional(),
        childSeat: z.number().int().min(0).max(10_000).optional(),
        tariffs: z.array(tariffSchema).min(1).max(12).optional(),
        airTimeScale: z.number().min(1).max(600).optional(),
        helicopters: z.array(airSchema).min(1).max(6).optional(),
        jets: z.array(airSchema).min(1).max(6).optional(),
      })
      .parse(req.body);
    saveSettings(ctx, b);
    return getSettings(ctx);
  });

  app.get('/api/admin/users', async () => ({
    users: db.prepare(`SELECT u.id, u.name, u.phone_masked phone, u.role, u.mandate_id IS NOT NULL linked, u.created_at createdAt, (SELECT COUNT(*) FROM rides r WHERE r.user_id = u.id AND r.status = 'completed') rides FROM users u ORDER BY u.created_at DESC LIMIT 200`).all(),
  }));
}
