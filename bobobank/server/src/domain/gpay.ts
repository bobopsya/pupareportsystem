import { HttpError, type Ctx } from '../context.js';
import { sign, SIGNATURE_HEADER } from './signing.js';

/** Signed call to GPAY's internal bank API over the docker network. */
export async function gpayRequest<T>(ctx: Ctx, method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
  if (!ctx.cfg.gpayInternalUrl || !ctx.cfg.gpaySecret) throw new HttpError(503, 'Связь с GPAY не настроена');
  const raw = body ? JSON.stringify(body) : '';
  let res: Response;
  try {
    res = await ctx.http(`${ctx.cfg.gpayInternalUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: sign(ctx.cfg.gpaySecret, method, path, raw, Math.floor(ctx.now() / 1000)) },
      body: body ? raw : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(502, 'GPAY не отвечает, попробуйте позже');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 400, data.error ?? `GPAY: ошибка ${res.status}`);
  return data;
}
