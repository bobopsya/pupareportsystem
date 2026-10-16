import { HttpError, type Ctx } from '../context.js';
import { sign, SIGNATURE_HEADER } from './signing.js';

export const bankEnabled = (ctx: Ctx) => !!(ctx.cfg.bankInternalUrl && ctx.cfg.bankSecret);

export class BankDown extends HttpError {
  constructor() {
    super(502, 'Bobobank не отвечает. Попробуйте через минуту.', 'bank_down');
  }
}

export interface BankCharge {
  id: string;
  status: 'held' | 'captured' | 'voided';
  amount: number;
  captured: number;
  refunded: number;
}

export interface MandateInfo {
  id: string;
  status: 'active' | 'revoked';
  usable: boolean;
  accountLast4: string;
  accountName: string;
  limit: number;
  available: number;
}

/** Signed call to Bobobank's partner API. Business errors (402, 403, 409) come back as HttpError with the bank's message and code. */
export async function bank<T>(ctx: Ctx, method: 'GET' | 'POST', path: string, body?: object, idempotenceKey?: string): Promise<T> {
  if (!bankEnabled(ctx)) throw new HttpError(503, 'Bobobank не подключён к Бобтелекому', 'bank_disabled');
  const full = `/internal/partner/v1${path}`;
  const raw = body ? JSON.stringify(body) : '';
  let res: Response;
  try {
    res = await ctx.bankHttp(`${ctx.cfg.bankInternalUrl}${full}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-partner-client': 'telecom',
        [SIGNATURE_HEADER]: sign(ctx.cfg.bankSecret, method, full, raw, Math.floor(ctx.now() / 1000)),
        ...(idempotenceKey ? { 'idempotence-key': idempotenceKey } : {}),
      },
      body: body ? raw : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new BankDown();
  }
  if (res.status >= 500) throw new BankDown();
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new HttpError(res.status === 401 ? 502 : res.status, data.error ?? `Bobobank: ошибка ${res.status}`, data.code);
  return data;
}

/** A one-step charge (hold and capture at once); the same external id never charges twice. */
export function chargeNow(ctx: Ctx, mandateId: string, amount: number, externalId: string, title: string, subtitle = '') {
  return bank<BankCharge>(ctx, 'POST', `/mandates/${mandateId}/charges`, { amount, external_id: externalId, title, subtitle }, externalId);
}

export function refund(ctx: Ctx, chargeId: string, amount: number, key: string) {
  return bank<BankCharge>(ctx, 'POST', `/charges/${chargeId}/refund`, { amount }, key);
}
