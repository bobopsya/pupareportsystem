import type { Ctx } from '../context.js';
import { tickCredit } from './credit.js';
import { releaseHold } from './ledger.js';
import { expireRequests } from './orders.js';

/** Time-driven work, every 2 seconds: expired purchase confirmations and holds, interest, loans, tariffs. */
export function tick(ctx: Ctx) {
  const now = ctx.now();
  ctx.db.prepare(`UPDATE authorizations SET status = 'expired', reason = 'confirmation_timeout', decided_at = ? WHERE status = 'pending' AND expires_at <= ?`).run(now, now);
  const stale = ctx.db.prepare(`SELECT id, hold_id FROM authorizations WHERE status = 'approved' AND expires_at <= ?`).all(now) as { id: string; hold_id: string | null }[];
  for (const a of stale) {
    if (a.hold_id) releaseHold(ctx, a.hold_id, 'expired');
    ctx.db.prepare(`UPDATE authorizations SET status = 'expired', decided_at = ? WHERE id = ?`).run(now, a.id);
  }
  ctx.db.prepare(`UPDATE holds SET status = 'expired' WHERE status = 'active' AND expires_at <= ?`).run(now);
  ctx.db.prepare('DELETE FROM idempotency WHERE created_at < ?').run(now - 24 * 3600_000);
  ctx.db.prepare('DELETE FROM phone_codes WHERE expires_at < ?').run(now - 3600_000);
  expireRequests(ctx);
  tickCredit(ctx);
}
