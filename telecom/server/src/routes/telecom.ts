import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { HttpError, type Ctx } from '../context.js';
import { answerCall, chats, conversation, currentCall, endCall, recentCalls, sendSms, startCall, unreadCount } from '../domain/comm.js';
import { buyAddon, changeTariff, chargeView, closeLine, connect, lineView, openLine, payNow, requireLine, type ChargeRow } from '../domain/lines.js';
import { offerNumbers } from '../domain/numbers.js';
import { getSettings } from '../domain/plans.js';
import { receiptPdf } from '../pdf.js';

export function registerTelecomRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/tariffs', async () => getSettings(ctx));

  app.get('/api/numbers', async (req) => {
    const q = z.object({ kind: z.enum(['plain', 'beautiful']).default('plain'), q: z.string().max(10).default(''), tariff: z.string().max(20).optional() }).parse(req.query);
    return { numbers: offerNumbers(ctx, q.kind, q.q, q.tariff === 'premium') };
  });

  /** My line with quotas, unread messages and the call on the screen (the app polls it). */
  app.get('/api/line', async (req) => {
    const u = requireUser(req);
    const l = openLine(ctx, u.id);
    return { line: l ? lineView(ctx, l) : null, unread: l ? unreadCount(ctx, l.number) : 0, call: l ? currentCall(ctx, u.id) : null, now: ctx.now() };
  });

  app.post('/api/line', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ number: z.string().max(30), tariff: z.string().max(20) }).parse(req.body);
    return lineView(ctx, await connect(ctx, requireUser(req), b));
  });

  app.post('/api/line/tariff', async (req) => {
    const b = z.object({ tariff: z.string().max(20), when: z.enum(['now', 'next']) }).parse(req.body);
    return lineView(ctx, await changeTariff(ctx, requireUser(req), b.tariff, b.when));
  });

  app.post('/api/line/addons', async (req) => {
    const b = z.object({ id: z.string().max(20) }).parse(req.body);
    return lineView(ctx, await buyAddon(ctx, requireUser(req), b.id));
  });

  app.post('/api/line/pay', async (req) => lineView(ctx, await payNow(ctx, requireUser(req))));

  app.post('/api/line/close', async (req) => {
    closeLine(ctx, requireUser(req));
    return { ok: true };
  });

  // ---- SMS ----
  app.get('/api/chats', async (req) => ({ chats: chats(ctx, requireUser(req).id) }));
  app.get('/api/chats/:number', async (req) => conversation(ctx, requireUser(req).id, (req.params as { number: string }).number));
  app.post('/api/sms', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ to: z.string().max(30), text: z.string().trim().min(1).max(500) }).parse(req.body);
    return sendSms(ctx, requireUser(req).id, b.to, b.text);
  });

  // ---- Calls ----
  app.get('/api/calls', async (req) => ({ calls: recentCalls(ctx, requireUser(req).id) }));
  app.post('/api/calls', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ to: z.string().max(30) }).parse(req.body);
    return startCall(ctx, requireUser(req).id, b.to);
  });
  app.post('/api/calls/:id/answer', async (req) => answerCall(ctx, requireUser(req).id, (req.params as { id: string }).id));
  app.post('/api/calls/:id/end', async (req) => endCall(ctx, requireUser(req).id, (req.params as { id: string }).id));

  // ---- Detalization ----
  app.get('/api/history', async (req) => {
    const u = requireUser(req);
    const line = requireLine(ctx, u.id);
    const charges = (ctx.db.prepare(`SELECT * FROM charges WHERE user_id = ? AND status IN ('paid', 'refunded') ORDER BY created_at DESC LIMIT 200`).all(u.id) as ChargeRow[]).map(chargeView);
    const sms = ctx.db
      .prepare(`SELECT id, to_number, created_at FROM messages WHERE from_number = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 200`)
      .all(line.number, line.created_at) as { id: string; to_number: string; created_at: number }[];
    const spent = (ctx.db.prepare(`SELECT COALESCE(SUM(amount - refunded), 0) s FROM charges WHERE user_id = ? AND status = 'paid'`).get(u.id) as { s: number }).s;
    return { charges, calls: recentCalls(ctx, u.id), sms: sms.map((m) => ({ id: m.id, to: m.to_number, createdAt: m.created_at })), spent };
  });

  app.get('/api/charges/:id/receipt.pdf', async (req, reply) => {
    const u = requireUser(req);
    const c = ctx.db.prepare('SELECT * FROM charges WHERE id = ? AND user_id = ?').get((req.params as { id: string }).id, u.id) as ChargeRow | undefined;
    if (!c || c.status === 'failed' || c.status === 'pending') throw new HttpError(404, 'Чек не найден');
    const line = ctx.db.prepare('SELECT number FROM lines WHERE id = ?').get(c.line_id) as { number: string };
    const pdf = await receiptPdf(c, line.number, u.name);
    return reply.type('application/pdf').header('Content-Disposition', `inline; filename="bobtelecom-${c.id}.pdf"`).send(pdf);
  });
}
