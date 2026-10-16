import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError, type Ctx, type SessionUser } from './context.js';
import { bank, bankEnabled, type MandateInfo } from './domain/bank.js';
import { newId, sha256 } from './util.js';

export const SESSION_COOKIE = 'bt_sid';
const STATE_COOKIE = 'bt_state';
export const SESSION_TTL_MS = 60 * 24 * 3600 * 1000;
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'bobotransport';

/** Without a session one can look at the map, search addresses and see prices. */
const isPublic = (url: string) =>
  url === '/api/health' || url === '/api/me' || url.startsWith('/api/auth/') || url.startsWith('/api/geo/') || url === '/api/cars/near' || url === '/api/rides/estimate' || url.startsWith('/api/bus/') || url.startsWith('/api/air/');

interface UserRow {
  id: string;
  name: string;
  role: 'rider' | 'admin';
  mandate_id: string | null;
  account_last4: string | null;
}

const toUser = (r: UserRow): SessionUser => ({ id: r.id, name: r.name, role: r.role, mandateId: r.mandate_id, accountLast4: r.account_last4 });

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, 'Войдите через Bobobank');
  return req.user;
}

export function registerAuth(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/')) return;
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers[CSRF_HEADER] !== CSRF_VALUE) return reply.code(403).send({ error: 'Запрос отклонён (CSRF)' });
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const h = sha256(token);
      const row = db.prepare('SELECT u.*, s.created_at AS s_created, s.last_seen AS s_seen FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(h) as (UserRow & { s_created: number; s_seen: number }) | undefined;
      const now = ctx.now();
      if (row && now - row.s_created < SESSION_TTL_MS) {
        if (now - row.s_seen > 60_000) db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now, h);
        req.user = toUser(row);
      } else if (row) {
        db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h);
      }
    }
    if (!isPublic(url) && !req.user) return reply.code(401).send({ error: 'Войдите через Bobobank' });
    if (url.startsWith('/api/admin/') && req.user?.role !== 'admin') return reply.code(403).send({ error: 'Нет доступа' });
  });

  const cookieOpts = { path: '/', httpOnly: true, secure: ctx.cfg.cookieSecure, sameSite: 'lax' as const };

  const startSession = (reply: FastifyReply, userId: string) => {
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions(token_hash, user_id, created_at, last_seen) VALUES(?,?,?,?)').run(sha256(token), userId, ctx.now(), ctx.now());
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOpts, maxAge: SESSION_TTL_MS / 1000 });
  };

  // «Войти через Bobobank»: the bank asks the customer which account to charge and sends them back with a one-time code.
  app.get('/api/auth/bank/start', async (req, reply) => {
    if (!bankEnabled(ctx) || !ctx.cfg.bankPublicUrl) return reply.redirect('/?auth_error=' + encodeURIComponent('Bobobank не подключён к Бобо.Транспорту'));
    const state = crypto.randomBytes(16).toString('base64url');
    reply.setCookie(STATE_COOKIE, state, { ...cookieOpts, maxAge: 15 * 60 });
    return reply.redirect(`${ctx.cfg.bankPublicUrl}/connect?client=transport&state=${state}`);
  });

  app.get('/api/auth/bank/callback', async (req, reply) => {
    const q = z.object({ code: z.string().max(100).optional(), state: z.string().max(200).optional() }).parse(req.query);
    const expected = req.cookies[STATE_COOKIE];
    reply.clearCookie(STATE_COOKIE, { path: '/' });
    if (!q.code || !q.state || !expected || q.state !== expected) return reply.redirect('/?auth_error=' + encodeURIComponent('Ссылка входа устарела. Нажмите «Войти через Bobobank» ещё раз.'));
    let r: { user: { id: string; name: string; phoneMasked: string }; mandate: MandateInfo };
    try {
      r = await bank(ctx, 'POST', '/auth/redeem', { code: q.code });
    } catch (e) {
      return reply.redirect('/?auth_error=' + encodeURIComponent((e as Error).message));
    }
    const now = ctx.now();
    const existing = db.prepare('SELECT id FROM users WHERE bank_user_id = ?').get(r.user.id) as { id: string } | undefined;
    const id = existing?.id ?? newId('usr', 16);
    if (existing) {
      db.prepare('UPDATE users SET name = ?, phone_masked = ?, mandate_id = ?, account_last4 = ?, last_seen = ? WHERE id = ?').run(r.user.name, r.user.phoneMasked, r.mandate.id, r.mandate.accountLast4, now, id);
    } else {
      db.prepare('INSERT INTO users(id, bank_user_id, name, phone_masked, mandate_id, account_last4, created_at, last_seen) VALUES(?,?,?,?,?,?,?,?)').run(id, r.user.id, r.user.name, r.user.phoneMasked, r.mandate.id, r.mandate.accountLast4, now, now);
    }
    if (req.user?.id !== id) startSession(reply, id);
    return reply.redirect('/?connected=1');
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req) => {
    const u = req.user;
    const extra = u ? (db.prepare('SELECT phone_masked, rating FROM users WHERE id = ?').get(u.id) as { phone_masked: string; rating: number }) : null;
    return {
      user: u && { id: u.id, name: u.name, role: u.role, phone: extra!.phone_masked, rating: extra!.rating, linked: !!u.mandateId, accountLast4: u.accountLast4 },
      bankUrl: ctx.cfg.bankPublicUrl || null,
      bankEnabled: bankEnabled(ctx),
    };
  });

  /** Linked account: what is available right now (to warn before ordering). */
  app.get('/api/me/account', async (req) => {
    const u = requireUser(req);
    if (!u.mandateId) return { linked: false };
    try {
      const m = await bank<MandateInfo>(ctx, 'GET', `/mandates/${u.mandateId}`);
      if (m.status !== 'active') {
        db.prepare('UPDATE users SET mandate_id = NULL WHERE id = ?').run(u.id);
        return { linked: false };
      }
      return { linked: true, ...m };
    } catch (e) {
      if (e instanceof HttpError && e.statusCode === 404) {
        db.prepare('UPDATE users SET mandate_id = NULL WHERE id = ?').run(u.id);
        return { linked: false };
      }
      return { linked: true, accountLast4: u.accountLast4, unavailable: true };
    }
  });
}
