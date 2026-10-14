import { ApiError, type Ctx } from '../context.js';
import { sign, SIGNATURE_HEADER } from './signing.js';

/** Bobobank is connected when both the internal URL and the shared secret are configured. */
export const bankEnabled = (ctx: Ctx) => !!(ctx.cfg.bankInternalUrl && ctx.cfg.bankSecret);

export class BankUnavailable extends ApiError {
  constructor() {
    super(502, 'issuer_unavailable', 'Банк-эмитент не отвечает. Попробуйте ещё раз через минуту.');
  }
}

/** Signed request to Bobobank's internal API. Business errors come back as { error, code } with 4xx. */
export async function bankRequest<T>(ctx: Ctx, method: 'GET' | 'POST', path: string, body?: object, idempotenceKey?: string): Promise<{ ok: boolean; status: number; data: T & { error?: string; code?: string } }> {
  if (!bankEnabled(ctx)) throw new ApiError(503, 'bank_disabled', 'Bobobank не подключён');
  const raw = body ? JSON.stringify(body) : '';
  let res: Response;
  try {
    res = await ctx.bankHttp(`${ctx.cfg.bankInternalUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: sign(ctx.cfg.bankSecret, method, path, raw, Math.floor(ctx.now() / 1000)),
        ...(idempotenceKey ? { 'idempotence-key': idempotenceKey } : {}),
      },
      body: body ? raw : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new BankUnavailable();
  }
  if (res.status >= 500) throw new BankUnavailable();
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  return { ok: res.ok, status: res.status, data };
}

/** Card number hashes and BINs of Bobobank cards, cached for a few seconds. */
let cache: { at: number; hashes: string[]; bins: string[] } | null = null;
export async function bankCards(ctx: Ctx, fresh = false): Promise<{ hashes: string[]; bins: string[] }> {
  if (!bankEnabled(ctx)) return { hashes: [], bins: [] };
  if (!fresh && cache && ctx.now() - cache.at < 10_000) return cache;
  try {
    const r = await bankRequest<{ hashes: string[]; bins: string[] }>(ctx, 'GET', '/internal/v1/cards');
    if (r.ok) cache = { at: ctx.now(), hashes: r.data.hashes, bins: r.data.bins };
  } catch {
    // The bank is down: game cards keep working.
  }
  return cache ?? { hashes: [], bins: [] };
}

export const resetBankCache = () => {
  cache = null;
};
