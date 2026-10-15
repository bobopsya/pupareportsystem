import { ApiError, HttpError, type Ctx } from '../context.js';
import { convert, getRates } from './fx.js';
import { getShop, type ShopRow } from './payments.js';
import { safeJson } from '../util.js';

/** Бобуслуги — the state services site (Supabase). GPAY calls its svc_* functions with the server key. */
export const gosEnabled = (ctx: Ctx) => !!(ctx.cfg.supabaseUrl && ctx.cfg.supabaseServiceKey && ctx.cfg.gosPublicUrl);

export interface GosBusiness {
  id: number;
  number: string;
  country_code: string;
  name: string;
  org_type: 'ИП' | 'Компания';
  inn: string;
}

export interface GosPerson {
  id: string;
  login: string;
  display_name: string;
  banned: boolean;
  passport: { last_name: string; first_name: string } | null;
  businesses: GosBusiness[];
}

const MESSAGES: Record<string, string> = {
  E_BAD_CODE: 'Ссылка входа устарела — попробуйте ещё раз',
  E_NOT_FOUND: 'Бизнес не найден в реестре Бобуслуг',
  E_REVOKED: 'Регистрация бизнеса отозвана',
};

export async function gosRpc<T>(ctx: Ctx, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!gosEnabled(ctx)) throw new HttpError(503, 'Бобуслуги не подключены к GPAY');
  const key = ctx.cfg.supabaseServiceKey;
  const headers: Record<string, string> = { 'content-type': 'application/json', apikey: key };
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`;
  let res: Response;
  try {
    res = await ctx.gosHttp(`${ctx.cfg.supabaseUrl}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args), signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new HttpError(502, 'Бобуслуги не отвечают, попробуйте позже');
  }
  const data = safeJson<unknown>(await res.text(), null);
  if (!res.ok) {
    const msg = String((data as { message?: string } | null)?.message ?? '');
    throw new HttpError(400, MESSAGES[msg] ?? 'Бобуслуги вернули ошибку');
  }
  return data as T;
}

export const gosUid = (ctx: Ctx, userId: string) => (ctx.db.prepare('SELECT gos_uid FROM users WHERE id = ?').get(userId) as { gos_uid: string | null } | undefined)?.gos_uid ?? null;

/** Businesses of the merchant from the registry (empty when the account is not linked). */
export async function businessesOf(ctx: Ctx, userId: string): Promise<GosBusiness[]> {
  const uid = gosUid(ctx, userId);
  if (!uid || !gosEnabled(ctx)) return [];
  return (await gosRpc<GosPerson>(ctx, 'svc_person', { p_user: uid })).businesses;
}

/** Ties a shop to a business: name and INN come from the registry, Бобуслуги show the shop in the business card. */
export async function linkShopBusiness(ctx: Ctx, shop: ShopRow, userId: string, businessId: number | null) {
  const uid = gosUid(ctx, userId);
  if (!uid) throw new ApiError(400, 'invalid_request', 'Войдите через Бобуслуги, чтобы привязать бизнес');
  if (businessId === null) {
    await gosRpc(ctx, 'svc_gpay_shop', { p_shop: shop.id, p_user: uid, p_doc: null, p_name: shop.name });
    ctx.db.prepare('UPDATE shops SET gos_doc_id = NULL WHERE id = ?').run(shop.id);
    return null;
  }
  const biz = (await businessesOf(ctx, userId)).find((b) => b.id === businessId);
  if (!biz) throw new ApiError(404, 'not_found', 'Бизнес не найден в реестре Бобуслуг');
  await gosRpc(ctx, 'svc_gpay_shop', { p_shop: shop.id, p_user: uid, p_doc: biz.id, p_name: shop.name, p_site: shop.site || null });
  const legal = biz.org_type === 'ИП' ? `ИП ${biz.name}` : `ООО «${biz.name}»`;
  ctx.db.prepare('UPDATE shops SET gos_doc_id = ?, legal_name = ?, inn = ? WHERE id = ?').run(biz.id, legal, biz.inn, shop.id);
  return getShop(ctx, shop.id)!;
}

/** Turnover in roubles (minor units) of succeeded payments minus refunds in [from, to). */
export function shopTurnover(ctx: Ctx, shopId: number, from: number, to: number): number {
  const rows = ctx.db
    .prepare(`SELECT currency, SUM(amount - refunded) s FROM payments WHERE shop_id = ? AND status = 'succeeded' AND funding = 'bank' AND created_at >= ? AND created_at < ? GROUP BY currency`)
    .all(shopId, from, to) as { currency: string; s: number }[];
  const rates = getRates(ctx.db);
  return rows.reduce((sum, r) => sum + convert(rates, r.s, r.currency, 'RUB'), 0);
}

/** Once an hour: yesterday's and 30-day turnover of shops linked to a business goes to Бобуслуги (turnover tax). */
export async function syncTurnover(ctx: Ctx) {
  if (!gosEnabled(ctx)) return 0;
  const now = ctx.now();
  const rows = ctx.db.prepare('SELECT * FROM shops WHERE gos_doc_id IS NOT NULL AND (gos_synced_at IS NULL OR gos_synced_at < ?)').all(now - 3600_000) as ShopRow[];
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const day = new Date(today - 86400_000).toISOString().slice(0, 10);
  for (const s of rows) {
    await gosRpc(ctx, 'svc_gpay_turnover', {
      p_shop: s.id,
      p_day: day,
      p_day_rub: shopTurnover(ctx, s.id, today - 86400_000, today),
      p_month_rub: shopTurnover(ctx, s.id, now - 30 * 86400_000, now),
    });
    ctx.db.prepare('UPDATE shops SET gos_synced_at = ? WHERE id = ?').run(now, s.id);
  }
  return rows.length;
}
