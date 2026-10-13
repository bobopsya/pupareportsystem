import argon2 from 'argon2';
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit, HttpError, type Ctx, type SessionUser } from './context.js';
import { newId, sha256 } from './util.js';

export const SESSION_COOKIE = 'gp_sid';
export const SESSION_TTL_MS = 14 * 24 * 3600 * 1000;
export const IDLE_TIMEOUT_MS = 24 * 3600 * 1000;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
export const LOCKOUT_MAX_FAILS = 8;
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'gpay';

/** Routes that work without a cabinet session. /api/v1 authenticates by API key instead. */
const isPublic = (url: string) =>
  url === '/api/health' || url === '/api/auth/login' || url === '/api/auth/register' || url.startsWith('/api/v1/') || url.startsWith('/api/checkout/') || url.startsWith('/api/public/');

export const passwordSchema = z.string().min(8, 'Пароль должен быть не короче 8 символов').max(200);
export const hashPassword = (pw: string) => argon2.hash(pw, { type: argon2.argon2id });

interface UserRow {
  id: string;
  email: string;
  name: string;
  pass_hash: string;
  role: 'merchant' | 'admin';
  blocked: number;
}

const toUser = (r: UserRow): SessionUser => ({ id: r.id, email: r.email, name: r.name, role: r.role });

let dummyHash: Promise<string> | null = null;

export async function createUser(ctx: Ctx, email: string, name: string, password: string, role: 'merchant' | 'admin' = 'merchant') {
  const exists = ctx.db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  if (exists) throw new HttpError(409, 'Пользователь с таким email уже зарегистрирован');
  const id = newId('usr', 16);
  ctx.db.prepare('INSERT INTO users(id, email, name, pass_hash, role, created_at) VALUES(?,?,?,?,?,?)').run(id, email, name, await hashPassword(password), role, ctx.now());
  return id;
}

export function registerAuth(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/')) return;
    // API v1 is called server-to-server with a secret key; everything else needs the CSRF header on writes.
    if (!url.startsWith('/api/v1/') && req.method !== 'GET' && req.method !== 'HEAD' && req.headers[CSRF_HEADER] !== CSRF_VALUE) {
      return reply.code(403).send({ error: 'Запрос отклонён (CSRF)' });
    }
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const tokenHash = sha256(token);
      const row = db
        .prepare('SELECT s.created_at, s.last_seen, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?')
        .get(tokenHash) as (UserRow & { created_at: number; last_seen: number }) | undefined;
      const now = ctx.now();
      if (row && !row.blocked && now - row.last_seen < IDLE_TIMEOUT_MS && now - row.created_at < SESSION_TTL_MS) {
        if (now - row.last_seen > 60_000) db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now, tokenHash);
        req.user = toUser(row);
      } else if (row) {
        db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      }
    }
    if (!isPublic(url) && !req.user) return reply.code(401).send({ error: 'Требуется вход' });
    if (url.startsWith('/api/admin/') && req.user?.role !== 'admin') return reply.code(403).send({ error: 'Нет доступа' });
  });

  const startSession = (req: FastifyRequest, reply: FastifyReply, userId: string) => {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = ctx.now();
    db.prepare('INSERT INTO sessions(token_hash, user_id, created_at, last_seen, ip, user_agent) VALUES(?,?,?,?,?,?)').run(sha256(token), userId, now, now, req.ip, String(req.headers['user-agent'] ?? '').slice(0, 300));
    reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, secure: ctx.cfg.cookieSecure, sameSite: 'lax', maxAge: SESSION_TTL_MS / 1000 });
  };

  const registerBody = z.object({
    email: z.string().trim().toLowerCase().email('Некорректный email').max(200),
    name: z.string().trim().min(2, 'Укажите имя').max(100),
    password: passwordSchema,
  });
  app.post('/api/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const body = registerBody.parse(req.body);
    const id = await createUser(ctx, body.email, body.name, body.password);
    startSession(req, reply, id);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
    req.user = toUser(row);
    audit(ctx, req, 'register', 'user', id, body.email);
    return { user: req.user };
  });

  const loginBody = z.object({ email: z.string().trim().min(1).max(200), password: z.string().min(1).max(200) });
  app.post('/api/auth/login', async (req, reply) => {
    const { email, password } = loginBody.parse(req.body);
    const now = ctx.now();
    db.prepare('DELETE FROM login_attempts WHERE ts < ?').run(now - LOCKOUT_WINDOW_MS);
    const fails = (db.prepare('SELECT COUNT(*) c FROM login_attempts WHERE ip = ?').get(req.ip) as { c: number }).c;
    if (fails >= LOCKOUT_MAX_FAILS) return reply.code(429).send({ error: 'Слишком много попыток. Попробуйте через 15 минут.' });
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
    dummyHash ??= hashPassword(crypto.randomBytes(16).toString('hex'));
    const ok = row ? await argon2.verify(row.pass_hash, password) : (await argon2.verify(await dummyHash, password), false);
    if (!row || !ok) {
      db.prepare('INSERT INTO login_attempts(ip, ts, email) VALUES(?,?,?)').run(req.ip, now, email);
      return reply.code(401).send({ error: 'Неверный email или пароль' });
    }
    if (row.blocked) return reply.code(403).send({ error: 'Аккаунт заблокирован. Обратитесь в поддержку GPAY.' });
    db.prepare('DELETE FROM login_attempts WHERE ip = ?').run(req.ip);
    startSession(req, reply, row.id);
    req.user = toUser(row);
    audit(ctx, req, 'login', 'user', row.id);
    return { user: req.user };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ user: req.user }));

  const changeBody = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema, name: z.string().trim().min(2).max(100).optional() });
  app.post('/api/auth/profile', async (req) => {
    const body = changeBody.partial({ currentPassword: true, newPassword: true }).parse(req.body);
    const user = requireUser(req);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow;
    if (body.name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(body.name, user.id);
    if (body.newPassword) {
      if (!body.currentPassword || !(await argon2.verify(row.pass_hash, body.currentPassword))) throw new HttpError(400, 'Текущий пароль неверен');
      db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(await hashPassword(body.newPassword), user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(user.id, sha256(req.cookies[SESSION_COOKIE] ?? ''));
      audit(ctx, req, 'password_change', 'user', user.id);
    }
    return { user: toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow) };
  });
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, 'Требуется вход');
  return req.user;
}
