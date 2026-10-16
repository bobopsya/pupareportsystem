import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, type Ctx } from '../context.js';
import { lineView, notifyLine, type LineRow } from '../domain/lines.js';
import { getSettings, saveSettings } from '../domain/plans.js';

const quota = z.number().int().min(-1).max(1_000_000);

export function registerAdminRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  app.get('/api/admin/overview', async () => {
    const now = ctx.now();
    const day = now - 86_400_000;
    const month = now - 30 * 86_400_000;
    const one = <T>(sql: string, ...a: unknown[]) => db.prepare(sql).get(...a) as T;
    return {
      users: one<{ c: number }>('SELECT COUNT(*) c FROM users').c,
      active: one<{ c: number }>(`SELECT COUNT(*) c FROM lines WHERE status = 'active'`).c,
      blocked: one<{ c: number }>(`SELECT COUNT(*) c FROM lines WHERE status = 'blocked'`).c,
      revenueMonth: one<{ s: number }>(`SELECT COALESCE(SUM(amount - refunded), 0) s FROM charges WHERE status = 'paid' AND paid_at >= ?`, month).s,
      callsDay: one<{ c: number }>('SELECT COUNT(*) c FROM calls WHERE created_at >= ?', day).c,
      smsDay: one<{ c: number }>('SELECT COUNT(*) c FROM messages WHERE created_at >= ?', day).c,
      homes: one<{ c: number }>(`SELECT COUNT(*) c FROM homes WHERE status IN ('active', 'blocked', 'scheduled')`).c,
      homesRevenueMonth: one<{ s: number }>(`SELECT COALESCE(SUM(amount - refunded), 0) s FROM charges WHERE status = 'paid' AND home_id IS NOT NULL AND paid_at >= ?`, month).s,
      byTariff: db.prepare(`SELECT tariff, COUNT(*) c FROM lines WHERE status IN ('active', 'blocked') GROUP BY tariff`).all(),
    };
  });

  app.get('/api/admin/lines', async () => {
    const rows = db.prepare(`SELECT l.*, u.name FROM lines l JOIN users u ON u.id = l.user_id WHERE l.status != 'connecting' ORDER BY l.created_at DESC LIMIT 300`).all() as (LineRow & { name: string })[];
    return { lines: rows.map((r) => ({ ...lineView(ctx, r), owner: r.name })) };
  });

  app.post('/api/admin/lines/:id/block', async (req) => {
    const b = z.object({ block: z.boolean() }).parse(req.body);
    const l = db.prepare(`SELECT * FROM lines WHERE id = ? AND status IN ('active', 'blocked')`).get((req.params as { id: string }).id) as LineRow | undefined;
    if (!l) throw new HttpError(404, 'Номер не найден');
    if (b.block) {
      db.prepare(`UPDATE lines SET status = 'blocked', block_reason = 'admin', retry_at = NULL WHERE id = ?`).run(l.id);
      notifyLine(ctx, l.number, 'Номер заблокирован администратором Бобтелекома.');
    } else {
      db.prepare(`UPDATE lines SET status = 'active', block_reason = NULL, retry_at = NULL WHERE id = ?`).run(l.id);
      notifyLine(ctx, l.number, 'Номер разблокирован. Связь работает.');
    }
    return { ok: true };
  });

  app.get('/api/admin/charges', async () => ({
    charges: db.prepare(`SELECT c.id, c.kind, c.title, c.amount, c.status, c.error, c.created_at createdAt, u.name, l.number FROM charges c JOIN users u ON u.id = c.user_id LEFT JOIN lines l ON l.id = c.line_id ORDER BY c.created_at DESC LIMIT 300`).all(),
  }));

  app.get('/api/admin/settings', async () => getSettings(ctx));
  app.put('/api/admin/settings', async (req) => {
    const b = z
      .object({
        tariffs: z
          .array(z.object({ id: z.string().regex(/^[a-z0-9_]{2,20}$/), title: z.string().min(1).max(40), price: z.number().int().min(0).max(100_000), minutes: quota, gb: quota, sms: quota, perks: z.array(z.string().max(80)).max(6) }))
          .min(1)
          .max(10),
        addons: z
          .array(z.object({ id: z.string().regex(/^[a-z0-9_]{2,20}$/), title: z.string().min(1).max(40), price: z.number().int().min(1).max(100_000), minutes: quota.optional(), gb: quota.optional(), sms: quota.optional(), roamingDays: z.number().int().min(1).max(90).optional() }))
          .max(10),
      })
      .parse(req.body);
    saveSettings(ctx, b);
    return getSettings(ctx);
  });

  app.get('/api/admin/users', async () => ({ users: db.prepare('SELECT id, name, phone_masked phone, role, created_at createdAt FROM users ORDER BY created_at DESC LIMIT 300').all() }));
}
