import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { HttpError, type Ctx } from '../context.js';
import { gosEnabled, gosRpc, syncLinks, type GosPerson } from '../domain/gos.js';
import { notifyLine, openLine } from '../domain/lines.js';

const GOS_COOKIE = 'bk_gos';

/** «Подтвердить через Бобуслуги»: the number is registered to the person's Бобопаспорт and shows in their cabinet. */
export function registerGosRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  app.get('/api/auth/gos/start', async (req, reply) => {
    if (!gosEnabled(ctx)) return reply.redirect('/profile?gos_error=' + encodeURIComponent('Бобуслуги не подключены к Бобтелекому'));
    if (!req.user) return reply.redirect('/');
    const state = crypto.randomBytes(24).toString('base64url');
    reply.setCookie(GOS_COOKIE, `${state}.${req.user.id}`, { path: '/api/auth/gos', httpOnly: true, secure: ctx.cfg.cookieSecure, sameSite: 'lax', maxAge: 15 * 60 });
    return reply.redirect(`${ctx.cfg.gosPublicUrl}/#/connect?client=telecom&state=${encodeURIComponent(state)}`);
  });

  app.get('/api/auth/gos/callback', async (req, reply) => {
    const q = z.object({ code: z.string().max(200).optional(), state: z.string().max(200).optional() }).parse(req.query);
    const fail = (msg: string) => reply.redirect('/profile?gos_error=' + encodeURIComponent(msg));
    const [state, userId] = String(req.cookies[GOS_COOKIE] ?? '').split('.');
    reply.clearCookie(GOS_COOKIE, { path: '/api/auth/gos' });
    if (!gosEnabled(ctx)) return fail('Бобуслуги не подключены');
    if (!q.code || !q.state || !state || q.state !== state) return fail('Подтверждение прервано — попробуйте ещё раз');
    if (!req.user || req.user.id !== userId) return fail('Войдите в Бобтелеком и подтвердите ещё раз');
    let p: GosPerson;
    try {
      p = await gosRpc<GosPerson>(ctx, 'svc_redeem_code', { p_code: q.code, p_client: 'telecom' });
    } catch (e) {
      return fail(e instanceof HttpError ? e.message : 'Бобуслуги не ответили');
    }
    if (p.banned) return fail('Аккаунт на Бобуслугах заблокирован');
    const other = db.prepare('SELECT id FROM users WHERE gos_uid = ? AND id != ?').get(p.id, userId);
    if (other) return fail('Этот аккаунт Бобуслуг уже подтверждает другой номер');
    const name = p.passport ? [p.passport.last_name, p.passport.first_name, p.passport.patronymic].filter(Boolean).join(' ') : p.display_name;
    db.prepare('UPDATE users SET gos_uid = ?, gos_login = ?, gos_name = ?, gos_passport = ?, gos_phone = NULL, gos_linked_at = ? WHERE id = ?').run(
      p.id,
      p.login,
      name,
      p.passport ? `${p.passport.country_code} ${p.passport.number}` : null,
      ctx.now(),
      userId,
    );
    const line = openLine(ctx, userId);
    if (line) notifyLine(ctx, line.number, `Номер оформлен на ${name} по данным Бобуслуг${p.passport ? '' : ' (Бобопаспорта пока нет)'}. Он появится в вашем кабинете на Бобуслугах.`);
    await syncLinks(ctx).catch(() => undefined);
    return reply.redirect('/profile?gos=linked');
  });

  app.post('/api/gos/unlink', async (req) => {
    const u = requireUser(req);
    const r = db.prepare('SELECT gos_uid, gos_phone FROM users WHERE id = ?').get(u.id) as { gos_uid: string | null; gos_phone: string | null };
    if (r.gos_uid && r.gos_phone) await gosRpc(ctx, 'svc_set_phone', { p_user: r.gos_uid, p_number: null }).catch(() => undefined);
    db.prepare('UPDATE users SET gos_uid = NULL, gos_login = NULL, gos_name = NULL, gos_passport = NULL, gos_phone = NULL, gos_linked_at = NULL WHERE id = ?').run(u.id);
    return { ok: true };
  });
}
