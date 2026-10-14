import argon2 from 'argon2';
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit, HttpError, type Ctx, type Role, type SessionUser } from './context.js';
import { normalizePhone } from './domain/transfers.js';
import { createUser, hashPassword } from './domain/users.js';
import { randomDigits, sha256 } from './util.js';

export const SESSION_COOKIE = 'bb_sid';
export const SESSION_TTL_MS = 14 * 24 * 3600 * 1000;
export const IDLE_TIMEOUT_MS = 24 * 3600 * 1000;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
export const LOCKOUT_MAX_FAILS = 8;
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'bobobank';
export const CODE_TTL_MS = 5 * 60_000;

/** Paths that work without a session. /internal is authenticated by GPAY's HMAC signature instead. */
const isPublic = (url: string) =>
  url === '/api/health' || url.startsWith('/api/auth/') || url.startsWith('/api/public/') || url.startsWith('/internal/');

export const passwordSchema = z.string().min(8, 'Пароль — не короче 8 символов').max(200);

interface UserRow {
  id: string;
  phone: string;
  name: string;
  pass_hash: string;
  role: Role;
  blocked: number;
  block_reason: string | null;
}

const toUser = (r: UserRow): SessionUser => ({ id: r.id, phone: r.phone, name: r.name, role: r.role });

let dummyHash: Promise<string> | null = null;

const phoneSchema = z.string().transform((v, c) => {
  const p = normalizePhone(v);
  if (!p) {
    c.addIssue({ code: 'custom', message: 'Введите номер в формате +7 900 000-00-00' });
    return z.NEVER;
  }
  return p;
});

export function registerAuth(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/')) return;
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers[CSRF_HEADER] !== CSRF_VALUE) {
      return reply.code(403).send({ error: 'Запрос отклонён (CSRF)' });
    }
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const tokenHash = sha256(token);
      const row = db
        .prepare('SELECT s.created_at s_created, s.last_seen, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?')
        .get(tokenHash) as (UserRow & { s_created: number; last_seen: number }) | undefined;
      const now = ctx.now();
      if (row && !row.blocked && now - row.last_seen < IDLE_TIMEOUT_MS && now - row.s_created < SESSION_TTL_MS) {
        if (now - row.last_seen > 60_000) db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now, tokenHash);
        req.user = toUser(row);
      } else if (row) {
        db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      }
    }
    if (!isPublic(url) && !req.user) return reply.code(401).send({ error: 'Требуется вход' });
    if (url.startsWith('/api/admin/') && req.user?.role !== 'admin') return reply.code(403).send({ error: 'Нет доступа' });
    if (url.startsWith('/api/support/') && req.user?.role !== 'admin' && req.user?.role !== 'support') return reply.code(403).send({ error: 'Нет доступа' });
  });

  const startSession = (req: FastifyRequest, reply: FastifyReply, userId: string) => {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = ctx.now();
    db.prepare('INSERT INTO sessions(token_hash, user_id, created_at, last_seen, ip, user_agent) VALUES(?,?,?,?,?,?)').run(sha256(token), userId, now, now, req.ip, String(req.headers['user-agent'] ?? '').slice(0, 300));
    reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, secure: ctx.cfg.cookieSecure, sameSite: 'lax', maxAge: SESSION_TTL_MS / 1000 });
  };

  // Step 1 of registration: a code "sent by SMS" — the app shows it as an on-screen message.
  app.post('/api/auth/code', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const { phone } = z.object({ phone: phoneSchema }).parse(req.body);
    if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) throw new HttpError(409, 'Этот номер уже зарегистрирован. Войдите по паролю.');
    const code = randomDigits(4);
    db.prepare('INSERT INTO phone_codes(phone, code_hash, expires_at, attempts) VALUES(?,?,?,0) ON CONFLICT(phone) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0').run(phone, sha256(`${phone}:${code}`), ctx.now() + CODE_TTL_MS);
    return { code, expiresIn: CODE_TTL_MS / 1000 };
  });

  const registerBody = z.object({
    phone: phoneSchema,
    code: z.string().regex(/^\d{4}$/, 'Код — 4 цифры'),
    name: z.string().trim().min(3, 'Укажите имя и фамилию').max(80).regex(/^[A-Za-zА-Яа-яЁё\- ]+$/, 'Имя — только буквы'),
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Укажите дату рождения'),
    password: passwordSchema,
  });
  app.post('/api/auth/register', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const body = registerBody.parse(req.body);
    const row = db.prepare('SELECT * FROM phone_codes WHERE phone = ?').get(body.phone) as { code_hash: string; expires_at: number; attempts: number } | undefined;
    if (!row || row.expires_at < ctx.now()) throw new HttpError(400, 'Код устарел — запросите новый');
    if (row.attempts >= 5) throw new HttpError(400, 'Слишком много попыток — запросите новый код');
    if (row.code_hash !== sha256(`${body.phone}:${body.code}`)) {
      db.prepare('UPDATE phone_codes SET attempts = attempts + 1 WHERE phone = ?').run(body.phone);
      throw new HttpError(400, 'Неверный код');
    }
    const age = (ctx.now() - Date.parse(body.birthDate)) / (365.25 * 24 * 3600_000);
    if (!(age >= 14 && age < 120)) throw new HttpError(400, 'Открыть счёт можно с 14 лет');
    const id = await createUser(ctx, body.phone, body.name.replace(/\s+/g, ' '), body.password, { birthDate: body.birthDate });
    db.prepare('DELETE FROM phone_codes WHERE phone = ?').run(body.phone);
    startSession(req, reply, id);
    req.user = toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow);
    audit(ctx, req, 'register', 'user', id, body.phone);
    return { user: req.user };
  });

  const loginBody = z.object({ phone: z.string().min(1).max(40), password: z.string().min(1).max(200) });
  app.post('/api/auth/login', async (req, reply) => {
    const body = loginBody.parse(req.body);
    const phone = normalizePhone(body.phone) ?? body.phone;
    const now = ctx.now();
    db.prepare('DELETE FROM login_attempts WHERE ts < ?').run(now - LOCKOUT_WINDOW_MS);
    const fails = (db.prepare('SELECT COUNT(*) c FROM login_attempts WHERE ip = ?').get(req.ip) as { c: number }).c;
    if (fails >= LOCKOUT_MAX_FAILS) return reply.code(429).send({ error: 'Слишком много попыток. Попробуйте через 15 минут.' });
    const row = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone) as UserRow | undefined;
    dummyHash ??= hashPassword(crypto.randomBytes(16).toString('hex'));
    const ok = row ? await argon2.verify(row.pass_hash, body.password) : (await argon2.verify(await dummyHash, body.password), false);
    if (!row || !ok) {
      db.prepare('INSERT INTO login_attempts(ip, ts, phone) VALUES(?,?,?)').run(req.ip, now, phone);
      return reply.code(401).send({ error: 'Неверный номер или пароль' });
    }
    if (row.blocked) return reply.code(403).send({ error: `Доступ в приложение заблокирован${row.block_reason ? `: ${row.block_reason}` : ''}. Позвоните в банк по номеру 900.` });
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

  const changeBody = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });
  app.post('/api/profile/password', async (req) => {
    const body = changeBody.parse(req.body);
    const user = requireUser(req);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow;
    if (!(await argon2.verify(row.pass_hash, body.currentPassword))) throw new HttpError(400, 'Текущий пароль неверен');
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(await hashPassword(body.newPassword), user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(user.id, sha256(req.cookies[SESSION_COOKIE] ?? ''));
    audit(ctx, req, 'password_change', 'user', user.id);
    return { ok: true };
  });
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, 'Требуется вход');
  return req.user;
}
