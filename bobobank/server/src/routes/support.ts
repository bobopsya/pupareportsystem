import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { audit, HttpError, type Ctx } from '../context.js';
import { serializeAccount, userAccounts } from '../domain/ledger.js';
import { addMessage, currentThread, type ThreadRow } from '../domain/support.js';
import { formatPhone, getUser } from '../domain/transfers.js';
import { restrictionView } from './client.js';

const messages = (ctx: Ctx, threadId: string) =>
  ctx.db.prepare('SELECT id, author, author_name authorName, body, created_at createdAt FROM support_messages WHERE thread_id = ? ORDER BY id').all(threadId);

export function registerSupportRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  // ---------- Customer chat ----------
  app.get('/api/chat', async (req) => {
    const u = requireUser(req);
    const t = currentThread(ctx, u.id, false);
    if (t && t.unread_client) db.prepare('UPDATE support_threads SET unread_client = 0 WHERE id = ?').run(t.id);
    const history = db.prepare(`SELECT id, subject, status, updated_at updatedAt FROM support_threads WHERE user_id = ? AND status = 'closed' ORDER BY updated_at DESC LIMIT 10`).all(u.id);
    return { thread: t ? { id: t.id, status: t.status, subject: t.subject } : null, messages: t ? messages(ctx, t.id) : [], history };
  });

  app.post('/api/chat', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const u = requireUser(req);
    const { body } = z.object({ body: z.string().trim().min(1).max(2000) }).parse(req.body);
    const isNew = !currentThread(ctx, u.id, false);
    const t = currentThread(ctx, u.id, true, body.slice(0, 60))!;
    addMessage(ctx, t, 'client', body, u.id, u.name);
    if (isNew) addMessage(ctx, t, 'bot', 'Здравствуйте! Я передал ваш вопрос специалисту — он ответит в этом чате. Обычно это занимает несколько минут.', null, 'Бобо-помощник');
    return { ok: true };
  });

  // ---------- Support desk (support and admin roles) ----------
  app.get('/api/support/threads', async (req) => {
    const q = z.object({ status: z.enum(['open', 'answered', 'closed', 'all']).default('open') }).parse(req.query);
    const rows = db
      .prepare(
        `SELECT t.*, u.name user_name, u.phone user_phone, (SELECT body FROM support_messages m WHERE m.thread_id = t.id ORDER BY id DESC LIMIT 1) last
         FROM support_threads t JOIN users u ON u.id = t.user_id ${q.status === 'all' ? '' : 'WHERE t.status = ?'} ORDER BY t.updated_at DESC LIMIT 100`,
      )
      .all(...(q.status === 'all' ? [] : [q.status])) as (ThreadRow & { user_name: string; user_phone: string; last: string })[];
    const counts = db.prepare(`SELECT status, COUNT(*) c FROM support_threads GROUP BY status`).all() as { status: string; c: number }[];
    return {
      items: rows.map((t) => ({ id: t.id, subject: t.subject, status: t.status, unread: t.unread_support, updatedAt: t.updated_at, user: { id: t.user_id, name: t.user_name, phone: formatPhone(t.user_phone) }, last: t.last })),
      counts: Object.fromEntries(counts.map((c) => [c.status, c.c])),
    };
  });

  app.get('/api/support/threads/:id', async (req) => {
    const t = db.prepare('SELECT * FROM support_threads WHERE id = ?').get((req.params as { id: string }).id) as ThreadRow | undefined;
    if (!t) throw new HttpError(404, 'Обращение не найдено');
    db.prepare('UPDATE support_threads SET unread_support = 0 WHERE id = ?').run(t.id);
    const user = getUser(ctx, t.user_id)!;
    return {
      thread: { id: t.id, subject: t.subject, status: t.status, createdAt: t.created_at },
      messages: messages(ctx, t.id),
      client: {
        id: user.id,
        name: user.name,
        phone: formatPhone(user.phone),
        tariff: user.tariff,
        blocked: !!user.blocked,
        accounts: userAccounts(ctx, user.id).map((a) => serializeAccount(ctx, a)),
        restrictions: restrictionView(ctx, user.id),
      },
    };
  });

  app.post('/api/support/threads/:id/reply', async (req) => {
    const u = requireUser(req);
    const t = db.prepare('SELECT * FROM support_threads WHERE id = ?').get((req.params as { id: string }).id) as ThreadRow | undefined;
    if (!t) throw new HttpError(404, 'Обращение не найдено');
    const { body } = z.object({ body: z.string().trim().min(1).max(4000) }).parse(req.body);
    if (t.status === 'closed') db.prepare(`UPDATE support_threads SET status = 'open' WHERE id = ?`).run(t.id);
    addMessage(ctx, t, 'support', body, u.id, u.name.split(' ')[0]);
    db.prepare('UPDATE support_threads SET assignee_id = COALESCE(assignee_id, ?) WHERE id = ?').run(u.id, t.id);
    audit(ctx, req, 'support_reply', 'thread', t.id);
    return { ok: true };
  });

  app.post('/api/support/threads/:id/status', async (req) => {
    const t = db.prepare('SELECT * FROM support_threads WHERE id = ?').get((req.params as { id: string }).id) as ThreadRow | undefined;
    if (!t) throw new HttpError(404, 'Обращение не найдено');
    const { status } = z.object({ status: z.enum(['open', 'closed']) }).parse(req.body);
    if (status === 'closed') addMessage(ctx, t, 'system', 'Обращение закрыто. Если вопрос остался — просто напишите в чат.');
    db.prepare('UPDATE support_threads SET status = ?, updated_at = ? WHERE id = ?').run(status, ctx.now(), t.id);
    return { ok: true };
  });
}
