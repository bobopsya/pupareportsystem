import argon2 from 'argon2';
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit, HttpError, type Ctx, type Role, type SessionUser } from './context.js';
import { fullName, gosEnabled, gosRpc, GosError, refreshPerson, saveGos, userByGosUid, type GosPerson } from './domain/gos.js';
import { normalizePhone } from './domain/transfers.js';
import { createUser, hashPassword } from './domain/users.js';
import { randomDigits, safeJson, sha256 } from './util.js';

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
    // Бобуслуги pages call /api/gos/v1 with their own token (CORS, no cookies): see routes/gos-api.ts.
    if (url.startsWith('/api/gos/v1/')) return;
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
    gosTicket: z.string().max(100).optional(),
  });
  app.post('/api/auth/register', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const body = registerBody.parse(req.body);
    // With Бобуслуги connected an account is opened only with a Бобопаспорт: name and birth date come from it.
    let person: GosPerson | null = null;
    if (gosEnabled(ctx)) {
      const t = body.gosTicket && (db.prepare('SELECT * FROM gos_tickets WHERE token_hash = ?').get(sha256(body.gosTicket)) as { person: string; expires_at: number } | undefined);
      if (!t || t.expires_at < ctx.now()) throw new HttpError(400, 'Откройте счёт через «Войти через Бобуслуги»: нужен Бобопаспорт', 'gos_required');
      person = safeJson<GosPerson | null>(t.person, null);
      if (!person?.passport) throw new HttpError(400, 'Нужен действующий Бобопаспорт: оформите его на Бобуслугах', 'gos_required');
      if (userByGosUid(ctx, person.id)) throw new HttpError(409, 'Этот аккаунт Бобуслуг уже привязан к клиенту банка — войдите');
      body.name = cleanName(fullName(person)) || body.name;
      if (/^\d{4}-\d{2}-\d{2}$/.test(person.passport.birth_date)) body.birthDate = person.passport.birth_date;
    }
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
    if (person) {
      saveGos(ctx, id, person);
      db.prepare('DELETE FROM gos_tickets WHERE token_hash = ?').run(sha256(body.gosTicket!));
    }
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

  // ---------- «Войти через Бобуслуги» ----------
  app.get('/api/public/config', async () => ({ gos: gosEnabled(ctx) ? { url: ctx.cfg.gosPublicUrl } : null }));

  const safeNext = (n: unknown) => (typeof n === 'string' && /^\/[a-zA-Z0-9/_?=&%.-]*$/.test(n) && !n.startsWith('//') ? n : '/app');
  const GOS_COOKIE = 'bb_gos';

  app.get('/api/auth/gos/start', async (req, reply) => {
    if (!gosEnabled(ctx)) return reply.redirect('/login');
    const q = req.query as { next?: string; link?: string };
    const state = crypto.randomBytes(24).toString('base64url');
    const linkUser = q.link === '1' && req.user ? req.user.id : null;
    db.prepare('DELETE FROM gos_states WHERE expires_at < ?').run(ctx.now());
    db.prepare('INSERT INTO gos_states(state_hash, next, link_user_id, expires_at) VALUES(?,?,?,?)').run(sha256(state), safeNext(q.next), linkUser, ctx.now() + 15 * 60_000);
    reply.setCookie(GOS_COOKIE, state, { path: '/api/auth/gos', httpOnly: true, secure: ctx.cfg.cookieSecure, sameSite: 'lax', maxAge: 15 * 60 });
    return reply.redirect(`${ctx.cfg.gosPublicUrl}/#/connect?client=bank&state=${encodeURIComponent(state)}`);
  });

  app.get('/api/auth/gos/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string };
    const fail = (msg: string) => reply.redirect(`/login?gosError=${encodeURIComponent(msg)}`);
    if (!gosEnabled(ctx)) return fail('Бобуслуги не подключены');
    const cookieState = req.cookies[GOS_COOKIE];
    reply.clearCookie(GOS_COOKIE, { path: '/api/auth/gos' });
    if (!q.state || !q.code || cookieState !== q.state) return fail('Вход прерван — попробуйте ещё раз');
    const st = db.prepare('SELECT * FROM gos_states WHERE state_hash = ?').get(sha256(q.state)) as { next: string; link_user_id: string | null; expires_at: number } | undefined;
    db.prepare('DELETE FROM gos_states WHERE state_hash = ?').run(sha256(q.state));
    if (!st || st.expires_at < ctx.now()) return fail('Вход устарел — попробуйте ещё раз');
    let person: GosPerson;
    try {
      person = await gosRpc<GosPerson>(ctx, 'svc_redeem_code', { p_code: q.code, p_client: 'bank' });
    } catch (e) {
      return fail(e instanceof GosError || e instanceof HttpError ? e.message : 'Бобуслуги не ответили');
    }
    if (person.banned) return fail('Аккаунт на Бобуслугах заблокирован');
    const existing = userByGosUid(ctx, person.id);
    if (st.link_user_id) {
      // Linking from the profile: the same browser must still be signed in as that customer.
      if (req.user?.id !== st.link_user_id) return fail('Войдите в банк и подключите Бобуслуги ещё раз');
      if (existing && existing.id !== st.link_user_id) return reply.redirect(`/app/profile?gosError=${encodeURIComponent('Этот аккаунт Бобуслуг уже привязан к другому клиенту')}`);
      saveGos(ctx, st.link_user_id, person);
      audit(ctx, req, 'gos_link', 'user', st.link_user_id, person.login);
      return reply.redirect('/app/profile?gos=linked');
    }
    if (existing) {
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id) as UserRow;
      if (row.blocked) return fail('Доступ в приложение заблокирован. Позвоните в банк по номеру 900.');
      saveGos(ctx, row.id, person);
      startSession(req, reply, row.id);
      req.user = toUser(row);
      audit(ctx, req, 'login_gos', 'user', row.id, person.login);
      return reply.redirect(st.next);
    }
    // New customer: registration continues with the name and birth date from the passport.
    const ticket = crypto.randomBytes(24).toString('base64url');
    db.prepare('DELETE FROM gos_tickets WHERE expires_at < ?').run(ctx.now());
    db.prepare('INSERT INTO gos_tickets(token_hash, person, next, expires_at) VALUES(?,?,?,?)').run(sha256(ticket), JSON.stringify(person), st.next, ctx.now() + 30 * 60_000);
    return reply.redirect(`/register?gos=${encodeURIComponent(ticket)}`);
  });

  app.get('/api/auth/gos/ticket', async (req) => {
    const t = String((req.query as { t?: string }).t ?? '');
    const row = db.prepare('SELECT * FROM gos_tickets WHERE token_hash = ?').get(sha256(t)) as { person: string; next: string; expires_at: number } | undefined;
    if (!row || row.expires_at < ctx.now()) throw new HttpError(404, 'Ссылка устарела — войдите через Бобуслуги ещё раз');
    const p = safeJson<GosPerson>(row.person, {} as GosPerson);
    return {
      login: p.login,
      name: cleanName(fullName(p)),
      birthDate: p.passport?.birth_date ?? null,
      passport: p.passport ? { number: p.passport.number, country: p.passport.country_code } : null,
      next: row.next,
    };
  });

  app.post('/api/profile/gos/refresh', async (req) => {
    const u = requireUser(req);
    const p = await refreshPerson(ctx, u.id);
    if (!p) throw new HttpError(400, 'Бобуслуги не подключены');
    return { ok: true };
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

/** Names from Бобуслуги may contain anything; the bank keeps letters, spaces and hyphens. */
const cleanName = (n: string) => n.replace(/[^A-Za-zА-Яа-яЁё\- ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
