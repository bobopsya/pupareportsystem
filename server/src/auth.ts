import argon2 from 'argon2';
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit, HttpError, type Ctx, type SessionUser } from './context.js';
import { sha256 } from './crypto.js';

export const SESSION_COOKIE = 'zn_sid';
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
export const LOCKOUT_MAX_FAILS = 5;
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'zhukonet';

const PUBLIC_PATHS = new Set(['/api/auth/login', '/api/health']);
/** Routes still allowed while the user must change a temporary password. */
const MUST_CHANGE_PATHS = new Set(['/api/auth/me', '/api/auth/logout', '/api/auth/change-password']);

export const passwordSchema = z.string().min(10, 'Пароль должен быть не короче 10 символов').max(200);

export function hashPassword(pw: string) {
  return argon2.hash(pw, { type: argon2.argon2id });
}

interface UserRow {
  id: string;
  login: string;
  pass_hash: string;
  must_change: number;
  data: string;
  deleted_at: number | null;
}

function userFromRow(row: UserRow): SessionUser {
  const data = JSON.parse(row.data);
  return { id: row.id, login: row.login, fullName: data.fullName ?? row.login, mustChange: !!row.must_change };
}

export function isLoginBlocked(row: UserRow): boolean {
  if (row.deleted_at) return true;
  return JSON.parse(row.data).status === 'fired';
}

// A precomputed hash so unknown logins cost the same time as known ones.
let dummyHash: Promise<string> | null = null;

export function registerAuth(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/')) return;

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers[CSRF_HEADER] !== CSRF_VALUE) {
      return reply.code(403).send({ error: 'Запрос отклонён (CSRF)' });
    }
    if (PUBLIC_PATHS.has(url)) return;

    const token = req.cookies[SESSION_COOKIE];
    if (!token) return reply.code(401).send({ error: 'Требуется вход' });
    const tokenHash = sha256(token);
    const row = db
      .prepare(
        `SELECT s.last_seen, u.id, u.login, u.pass_hash, u.must_change, u.data, u.deleted_at
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
      )
      .get(tokenHash) as (UserRow & { last_seen: number }) | undefined;
    const now = ctx.now();
    if (!row || now - row.last_seen > IDLE_TIMEOUT_MS || isLoginBlocked(row)) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      clearCookie(reply, ctx);
      return reply.code(401).send({ error: 'Сессия истекла, войдите снова' });
    }
    db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now, tokenHash);
    req.user = userFromRow(row);
    if (req.user.mustChange && !MUST_CHANGE_PATHS.has(url)) {
      return reply.code(403).send({ error: 'Сначала смените временный пароль', mustChange: true });
    }
  });

  const loginBody = z.object({ login: z.string().min(1).max(100), password: z.string().min(1).max(200) });

  app.post('/api/auth/login', async (req, reply) => {
    const { login, password } = loginBody.parse(req.body);
    const now = ctx.now();
    const ip = req.ip;
    db.prepare('DELETE FROM login_attempts WHERE ts < ?').run(now - LOCKOUT_WINDOW_MS);
    const fails = (db.prepare('SELECT COUNT(*) c FROM login_attempts WHERE ip = ? AND ts >= ?').get(ip, now - LOCKOUT_WINDOW_MS) as { c: number }).c;
    if (fails >= LOCKOUT_MAX_FAILS) {
      audit(ctx, req, 'login_fail', 'user', null, `Блокировка IP, логин «${login}»`, { id: null, login });
      return reply.code(429).send({ error: 'Слишком много попыток. Попробуйте через 15 минут.' });
    }

    const row = db.prepare('SELECT * FROM users WHERE login = ?').get(login) as UserRow | undefined;
    dummyHash ??= hashPassword(crypto.randomBytes(16).toString('hex'));
    const ok = row ? await argon2.verify(row.pass_hash, password) : (await argon2.verify(await dummyHash, password), false);
    if (!row || !ok || isLoginBlocked(row)) {
      db.prepare('INSERT INTO login_attempts(ip, ts, login) VALUES(?,?,?)').run(ip, now, login);
      audit(ctx, req, 'login_fail', 'user', row?.id ?? null, `Неудачный вход «${login}»`, { id: null, login });
      return reply.code(401).send({ error: 'Неверный логин или пароль' });
    }
    db.prepare('DELETE FROM login_attempts WHERE ip = ?').run(ip);

    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions(token_hash, user_id, created_at, last_seen, ip, user_agent) VALUES(?,?,?,?,?,?)').run(
      sha256(token), row.id, now, now, ip, String(req.headers['user-agent'] ?? '').slice(0, 300),
    );
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/', httpOnly: true, secure: ctx.cfg.cookieSecure, sameSite: 'strict',
    });
    const user = userFromRow(row);
    audit(ctx, req, 'login', 'user', row.id, null, { id: row.id, login: row.login });
    return { user };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    audit(ctx, req, 'logout', 'user', req.user?.id ?? null);
    clearCookie(reply, ctx);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ user: req.user, idleTimeoutMs: IDLE_TIMEOUT_MS }));

  const changeBody = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });
  app.post('/api/auth/change-password', async (req) => {
    const { currentPassword, newPassword } = changeBody.parse(req.body);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as UserRow;
    if (!(await argon2.verify(row.pass_hash, currentPassword))) throw new HttpError(400, 'Текущий пароль неверен');
    if (currentPassword === newPassword) throw new HttpError(400, 'Новый пароль должен отличаться от текущего');
    db.prepare('UPDATE users SET pass_hash = ?, must_change = 0, updated_at = ? WHERE id = ?').run(await hashPassword(newPassword), ctx.now(), row.id);
    // Drop all other sessions of this user.
    const current = sha256(req.cookies[SESSION_COOKIE] ?? '');
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(row.id, current);
    audit(ctx, req, 'password_change', 'user', row.id);
    return { ok: true };
  });
}

function clearCookie(reply: FastifyReply, ctx: Ctx) {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: ctx.cfg.cookieSecure, sameSite: 'strict' });
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, 'Требуется вход');
  return req.user;
}
