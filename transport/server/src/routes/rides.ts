import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { HttpError, type Ctx } from '../context.js';
import { inMoscow, type LatLon } from '../domain/geo.js';
import { reverse, search } from '../domain/maps.js';
import { board, cancel, complete, createRide, currentRide, estimate, historyItem, nearCars, ownRide, rate, serializeRide, settle, getRide } from '../domain/rides.js';
import { receiptPdf } from '../pdf.js';
import { newId } from '../util.js';

const lat = z.number().min(-90).max(90);
const lon = z.number().min(-180).max(180);
const point = z.object({ lat, lon, title: z.string().max(200).default(''), subtitle: z.string().max(300).default('') });
const coords = z.object({ lat: z.coerce.number().min(-90).max(90), lon: z.coerce.number().min(-180).max(180) });
const TARIFFS = ['econom', 'comfort', 'comfort_plus', 'business', 'kids'] as const;

export function registerRideRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  // ---- Addresses ----
  app.get('/api/geo/search', { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } }, async (req) => {
    const { q } = z.object({ q: z.string().max(200).default('') }).parse(req.query);
    return { items: await search(ctx, q) };
  });

  app.get('/api/geo/reverse', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const p = coords.parse(req.query);
    const ll: LatLon = [p.lat, p.lon];
    if (!inMoscow(ll)) return { title: 'За пределами Москвы', subtitle: 'Бобо.Транспорт пока работает только в Москве', lat: p.lat, lon: p.lon, outside: true };
    return reverse(ctx, ll);
  });

  app.get('/api/cars/near', async (req) => {
    const p = coords.parse(req.query);
    if (!inMoscow([p.lat, p.lon])) return { cars: [] };
    return { cars: await nearCars(ctx, [p.lat, p.lon]) };
  });

  // ---- Places ----
  app.get('/api/places', async (req) => {
    const u = requireUser(req);
    const places = db.prepare('SELECT id, kind, title, address, lat, lon FROM places WHERE user_id = ? ORDER BY kind, created_at').all(u.id);
    // Recent destinations from history, without duplicates.
    const recent = (db.prepare(`SELECT to_json FROM rides WHERE user_id = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 30`).all(u.id) as { to_json: string }[])
      .map((r) => JSON.parse(r.to_json) as z.infer<typeof point>)
      .filter((p, i, arr) => arr.findIndex((q) => q.title === p.title) === i)
      .slice(0, 5);
    return { places, recent };
  });

  app.post('/api/places', async (req) => {
    const u = requireUser(req);
    const b = z.object({ kind: z.enum(['home', 'work', 'fav']), title: z.string().min(1).max(60), address: z.string().max(200), lat, lon }).parse(req.body);
    if (!inMoscow([b.lat, b.lon])) throw new HttpError(400, 'Адрес должен быть в Москве');
    if (b.kind !== 'fav') db.prepare('DELETE FROM places WHERE user_id = ? AND kind = ?').run(u.id, b.kind);
    else if ((db.prepare(`SELECT COUNT(*) c FROM places WHERE user_id = ? AND kind = 'fav'`).get(u.id) as { c: number }).c >= 20) throw new HttpError(400, 'Не больше 20 избранных адресов');
    const id = newId('plc', 12);
    db.prepare('INSERT INTO places(id, user_id, kind, title, address, lat, lon, created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, u.id, b.kind, b.title, b.address, b.lat, b.lon, ctx.now());
    return { id };
  });

  app.delete('/api/places/:id', async (req) => {
    const u = requireUser(req);
    db.prepare('DELETE FROM places WHERE id = ? AND user_id = ?').run((req.params as { id: string }).id, u.id);
    return { ok: true };
  });

  // ---- Rides ----
  app.post('/api/rides/estimate', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ from: point, to: point }).parse(req.body);
    return estimate(ctx, req.user?.id ?? null, b.from, b.to);
  });

  app.post('/api/rides', async (req) => {
    const u = requireUser(req);
    const b = z.object({ estimateId: z.string().max(64), tariff: z.enum(TARIFFS), childSeat: z.boolean().optional(), comment: z.string().max(200).optional() }).parse(req.body);
    const r = await createRide(ctx, u, b);
    return serializeRide(ctx, r);
  });

  app.get('/api/rides/current', async (req) => {
    const u = requireUser(req);
    const r = currentRide(ctx, u.id);
    if (r) return { ride: serializeRide(ctx, r) };
    // The last finished ride waiting for a rating (for a few minutes after the end).
    const last = db.prepare(`SELECT * FROM rides WHERE user_id = ? AND status = 'completed' AND rating IS NULL AND finished_at > ? ORDER BY finished_at DESC LIMIT 1`).get(u.id, ctx.now() - 10 * 60_000) as
      | Parameters<typeof serializeRide>[1]
      | undefined;
    return { ride: last ? serializeRide(ctx, last) : null };
  });

  app.get('/api/rides/:id', async (req) => serializeRide(ctx, ownRide(ctx, requireUser(req).id, (req.params as { id: string }).id)));

  app.post('/api/rides/:id/cancel', async (req) => {
    const r = ownRide(ctx, requireUser(req).id, (req.params as { id: string }).id);
    cancel(ctx, r, 'user');
    await settle(ctx, getRide(ctx, r.id)!);
    return serializeRide(ctx, getRide(ctx, r.id)!);
  });

  app.post('/api/rides/:id/board', async (req) => {
    const r = ownRide(ctx, requireUser(req).id, (req.params as { id: string }).id);
    board(ctx, r);
    return serializeRide(ctx, getRide(ctx, r.id)!);
  });

  /** «Остановите здесь»: the ride ends where the car is, the price is for the part driven. */
  app.post('/api/rides/:id/stop', async (req) => {
    const r = ownRide(ctx, requireUser(req).id, (req.params as { id: string }).id);
    if (r.status !== 'in_ride' || !r.started_at || !r.finish_at) throw new HttpError(409, 'Поездка не идёт');
    complete(ctx, r, (ctx.now() - r.started_at) / (r.finish_at - r.started_at));
    await settle(ctx, getRide(ctx, r.id)!);
    return serializeRide(ctx, getRide(ctx, r.id)!);
  });

  app.post('/api/rides/:id/rate', async (req) => {
    const u = requireUser(req);
    const r = ownRide(ctx, u.id, (req.params as { id: string }).id);
    const b = z.object({ stars: z.number().int().min(1).max(5), tip: z.number().int().min(0).max(5000_00).default(0) }).parse(req.body);
    await rate(ctx, r, u.mandateId, b.stars, b.tip);
    return serializeRide(ctx, getRide(ctx, r.id)!);
  });

  app.get('/api/rides', async (req) => {
    const u = requireUser(req);
    const { before } = z.object({ before: z.coerce.number().optional() }).parse(req.query);
    const rows = db.prepare(`SELECT * FROM rides WHERE user_id = ? AND status IN ('completed','cancelled') AND created_at < ? ORDER BY created_at DESC LIMIT 30`).all(u.id, before ?? Number.MAX_SAFE_INTEGER) as Parameters<typeof historyItem>[1][];
    const total = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(final_price), 0) s, COALESCE(SUM(distance_m * COALESCE(progress, 1)), 0) d FROM rides WHERE user_id = ? AND status = 'completed'`).get(u.id) as { n: number; s: number; d: number };
    return { rides: rows.map((r) => historyItem(ctx, r)), stats: { rides: total.n, spent: total.s, km: Math.round(total.d / 1000) } };
  });

  app.get('/api/rides/:id/receipt.pdf', async (req, reply) => {
    const r = ownRide(ctx, requireUser(req).id, (req.params as { id: string }).id);
    if (!r.final_price || r.bank_status !== 'captured') throw new HttpError(409, 'Чек появится после списания оплаты');
    const pdf = await receiptPdf(ctx, r);
    return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="bobo-transport-${r.id}.pdf"`).send(pdf);
  });
}
