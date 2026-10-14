import type { Ctx } from '../context.js';
import { newId } from '../util.js';

export interface ThreadRow {
  id: string;
  user_id: string;
  subject: string;
  status: 'open' | 'answered' | 'closed';
  assignee_id: string | null;
  unread_client: number;
  unread_support: number;
  created_at: number;
  updated_at: number;
}

/** The customer's current conversation (one chat, like in banking apps); a new one starts after closing. */
export function currentThread(ctx: Ctx, userId: string, create: boolean, subject = 'Обращение'): ThreadRow | undefined {
  const t = ctx.db.prepare(`SELECT * FROM support_threads WHERE user_id = ? AND status != 'closed' ORDER BY updated_at DESC LIMIT 1`).get(userId) as ThreadRow | undefined;
  if (t || !create) return t;
  const id = newId('thr', 12);
  ctx.db.prepare('INSERT INTO support_threads(id, user_id, subject, created_at, updated_at) VALUES(?,?,?,?,?)').run(id, userId, subject, ctx.now(), ctx.now());
  return ctx.db.prepare('SELECT * FROM support_threads WHERE id = ?').get(id) as ThreadRow;
}

export function addMessage(ctx: Ctx, thread: ThreadRow, author: 'client' | 'support' | 'system' | 'bot', body: string, authorId: string | null = null, authorName = '') {
  ctx.db.prepare('INSERT INTO support_messages(thread_id, author, author_id, author_name, body, created_at) VALUES(?,?,?,?,?,?)').run(thread.id, author, authorId, authorName, body, ctx.now());
  if (author === 'client') ctx.db.prepare(`UPDATE support_threads SET unread_support = unread_support + 1, status = 'open', updated_at = ? WHERE id = ?`).run(ctx.now(), thread.id);
  else ctx.db.prepare(`UPDATE support_threads SET unread_client = unread_client + 1, status = CASE WHEN ? = 'support' THEN 'answered' ELSE status END, updated_at = ? WHERE id = ?`).run(author, ctx.now(), thread.id);
}

/** A bank notice in the customer's chat (blocks, arrests and the like). */
export function systemMessage(ctx: Ctx, userId: string, body: string, subject = 'Уведомление банка') {
  const t = currentThread(ctx, userId, true, subject)!;
  addMessage(ctx, t, 'system', body);
}
