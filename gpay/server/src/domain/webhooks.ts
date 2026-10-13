import dns from 'node:dns/promises';
import net from 'node:net';
import type { Ctx } from '../context.js';
import { hmacHex, newId, safeJson } from '../util.js';

export const EVENTS = ['payment.waiting_for_capture', 'payment.succeeded', 'payment.canceled', 'refund.succeeded', 'payout.succeeded'] as const;
export type WebhookEvent = (typeof EVENTS)[number];

/** Delay before attempt N+1 (ms). The last retry lands ~24 h after the first attempt. */
export const RETRY_DELAYS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 5 * 3600_000, 16 * 3600_000];

export function signature(secret: string, ts: number, body: string) {
  return `t=${ts},v1=${hmacHex(secret, `${ts}.${body}`)}`;
}

/** Queues the event for every active endpoint of the shop subscribed to it. */
export function enqueue(ctx: Ctx, shopId: number, event: WebhookEvent, object: { id: string }) {
  const hooks = ctx.db.prepare('SELECT id, events FROM webhooks WHERE shop_id = ? AND active = 1').all(shopId) as { id: string; events: string }[];
  const now = ctx.now();
  for (const h of hooks) {
    if (!safeJson<string[]>(h.events, []).includes(event)) continue;
    const id = newId('evt', 20);
    const payload = JSON.stringify({ type: 'notification', id, event, created_at: new Date(now).toISOString(), object });
    ctx.db
      .prepare(`INSERT INTO webhook_deliveries(id, webhook_id, shop_id, event, object_id, payload, status, attempts, next_at, created_at, updated_at) VALUES(?,?,?,?,?,?,'pending',0,?,?,?)`)
      .run(id, h.id, shopId, event, object.id, payload, now, now, now);
  }
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

/** Rejects endpoints that resolve to loopback/private networks so merchants cannot probe the server's internal services. */
export async function checkTarget(ctx: Ctx, url: string): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'Некорректный URL';
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Поддерживаются только http(s) URL';
  if (ctx.cfg.webhookAllowPrivate) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  try {
    const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
    if (addrs.some((a) => isPrivateIp(a.address))) return 'Адрес указывает на внутреннюю сеть';
  } catch {
    return 'Не удалось определить IP-адрес хоста';
  }
  return null;
}

interface DeliveryRow {
  id: string;
  webhook_id: string;
  payload: string;
  attempts: number;
  created_at: number;
}

export async function deliver(ctx: Ctx, d: DeliveryRow): Promise<boolean> {
  const hook = ctx.db.prepare('SELECT url, secret, active FROM webhooks WHERE id = ?').get(d.webhook_id) as { url: string; secret: string; active: number } | undefined;
  const now = ctx.now();
  const attempts = d.attempts + 1;
  let code: number | null = null;
  let error: string | null = null;
  let body: string | null = null;
  const started = Date.now();
  if (!hook) error = 'Эндпоинт удалён';
  else {
    error = await checkTarget(ctx, hook.url);
    if (!error) {
      try {
        const ts = Math.floor(now / 1000);
        const res = await ctx.http(hook.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'GPAY-Webhooks/1.0', 'GPAY-Signature': signature(hook.secret, ts, d.payload), 'GPAY-Event-Id': d.id },
          body: d.payload,
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
        });
        code = res.status;
        body = (await res.text().catch(() => '')).slice(0, 1000);
        if (code < 200 || code >= 300) error = `HTTP ${code}`;
      } catch (e) {
        error = (e as Error).name === 'TimeoutError' ? 'Таймаут 10 с' : `Ошибка соединения: ${(e as Error).message}`.slice(0, 300);
      }
    }
  }
  const ok = !error;
  const delay = RETRY_DELAYS[attempts - 1];
  const status = ok ? 'succeeded' : hook && delay !== undefined ? 'pending' : 'failed';
  ctx.db
    .prepare('UPDATE webhook_deliveries SET status = ?, attempts = ?, next_at = ?, last_code = ?, last_error = ?, last_body = ?, last_ms = ?, updated_at = ? WHERE id = ?')
    .run(status, attempts, status === 'pending' ? now + delay : null, code, error, body, Date.now() - started, now, d.id);
  return ok;
}

let busy = false;

/** Sends due deliveries; called by the background loop. */
export async function deliverDue(ctx: Ctx, limit = 20) {
  if (busy) return 0;
  busy = true;
  try {
    const due = ctx.db.prepare(`SELECT id, webhook_id, payload, attempts, created_at FROM webhook_deliveries WHERE status = 'pending' AND next_at <= ? ORDER BY next_at LIMIT ?`).all(ctx.now(), limit) as DeliveryRow[];
    await Promise.all(due.map((d) => deliver(ctx, d)));
    return due.length;
  } finally {
    busy = false;
  }
}
