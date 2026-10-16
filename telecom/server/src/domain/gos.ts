import { HttpError, type Ctx } from '../context.js';
import { safeJson } from '../util.js';
import { bank } from './bank.js';

export const gosEnabled = (ctx: Ctx) => !!(ctx.cfg.supabaseUrl && ctx.cfg.supabaseServiceKey && ctx.cfg.gosPublicUrl);

export class GosError extends HttpError {
  constructor(code: string, message: string) {
    super(502, message, code);
  }
}

const GOS_MESSAGES: Record<string, string> = {
  E_BAD_CODE: 'Ссылка входа устарела — попробуйте ещё раз',
  E_NOT_FOUND: 'Не найдено на Бобуслугах',
  E_BAD_DATA: 'Бобуслуги не приняли данные',
};

/** Calls an svc_* function of Бобуслуги with the service key (from the server only). Errors are E_* codes. */
export async function gosRpc<T>(ctx: Ctx, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!gosEnabled(ctx)) throw new HttpError(503, 'Бобуслуги не подключены к Бобтелекому', 'gos_disabled');
  const key = ctx.cfg.supabaseServiceKey;
  const headers: Record<string, string> = { 'content-type': 'application/json', apikey: key };
  // Legacy keys are JWTs and go in Authorization as well; new sb_secret_ keys go only in apikey.
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`;
  let res: Response;
  try {
    res = await ctx.gosHttp(`${ctx.cfg.supabaseUrl}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args), signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new GosError('E_DOWN', 'Бобуслуги не отвечают, попробуйте позже');
  }
  const text = await res.text();
  const data = safeJson<unknown>(text, null);
  if (!res.ok) {
    const msg = String((data as { message?: string } | null)?.message ?? '');
    const code = /^E_[A-Z_]+$/.test(msg) ? msg : 'E_GOS';
    throw new GosError(code, GOS_MESSAGES[code] ?? 'Бобуслуги вернули ошибку');
  }
  return data as T;
}

export interface GosPerson {
  id: string;
  login: string;
  display_name: string;
  banned: boolean;
  passport: { number: string; country_code: string; last_name: string; first_name: string; patronymic?: string; birth_date: string } | null;
}

/** The number on the person's passport (Бобуслуги) and the number Bobobank sends transfers to: follow the open line. */
export async function syncLinks(ctx: Ctx) {
  const rows = ctx.db
    .prepare(
      `SELECT u.id, u.mandate_id, u.bank_phone, u.gos_uid, u.gos_phone, l.number FROM users u
       LEFT JOIN lines l ON l.user_id = u.id AND l.status IN ('active', 'blocked')
       WHERE (u.mandate_id IS NOT NULL AND COALESCE(l.number, '') != COALESCE(u.bank_phone, ''))
          OR (u.gos_uid IS NOT NULL AND COALESCE(l.number, '') != COALESCE(u.gos_phone, ''))
       LIMIT 20`,
    )
    .all() as { id: string; mandate_id: string | null; bank_phone: string | null; gos_uid: string | null; gos_phone: string | null; number: string | null }[];
  for (const r of rows) {
    if (r.mandate_id && (r.number ?? null) !== r.bank_phone) {
      await bank(ctx, 'POST', `/mandates/${r.mandate_id}/phone`, { phone: r.number ?? null })
        .then(() => ctx.db.prepare('UPDATE users SET bank_phone = ? WHERE id = ?').run(r.number ?? null, r.id))
        .catch((e) => {
          // The customer revoked the link in the bank: forget the mandate, nothing to sync.
          if (e instanceof HttpError && e.statusCode === 404) ctx.db.prepare('UPDATE users SET mandate_id = NULL WHERE id = ?').run(r.id);
        });
    }
    if (r.gos_uid && gosEnabled(ctx) && (r.number ?? null) !== r.gos_phone) {
      await gosRpc(ctx, 'svc_set_phone', { p_user: r.gos_uid, p_number: r.number ?? null })
        .then(() => ctx.db.prepare('UPDATE users SET gos_phone = ? WHERE id = ?').run(r.number ?? null, r.id))
        .catch(() => undefined);
    }
  }
}
