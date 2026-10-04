import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, HttpError, type Ctx } from '../context.js';
import { getSetting, setSetting } from '../db.js';
import { getRow } from './records.js';

/**
 * Vault key material. The data-encryption key (DEK) never reaches the server in plaintext:
 * it is wrapped in the browser with a key derived from the master password, and again
 * with a key derived from the recovery code.
 */
const b64 = z.string().min(1).max(2000);
export const vaultMetaSchema = z.object({
  version: z.literal(1),
  kdf: z.literal('PBKDF2-SHA256'),
  iterations: z.number().int().min(100_000).max(10_000_000),
  masterSalt: b64,
  masterWrapped: z.object({ iv: b64, ct: b64 }),
  recoverySalt: b64,
  recoveryWrapped: z.object({ iv: b64, ct: b64 }),
});

const KEY = 'vault_meta';

export function registerVaultRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/vault/meta', async () => {
    const raw = getSetting(ctx.db, KEY);
    return { initialized: !!raw, meta: raw ? JSON.parse(raw) : null };
  });

  app.post('/api/vault/init', async (req) => {
    const meta = vaultMetaSchema.parse(req.body);
    const done = ctx.db.transaction(() => {
      if (getSetting(ctx.db, KEY)) return false;
      setSetting(ctx.db, KEY, JSON.stringify(meta));
      return true;
    })();
    if (!done) throw new HttpError(409, 'Хранилище уже инициализировано');
    audit(ctx, req, 'vault_init', 'vault');
    return { ok: true };
  });

  /** Changing the master key (or recovery code) only re-wraps the same DEK, so items stay readable. */
  app.put('/api/vault/meta', async (req) => {
    const meta = vaultMetaSchema.parse(req.body);
    if (!getSetting(ctx.db, KEY)) throw new HttpError(409, 'Хранилище ещё не создано');
    setSetting(ctx.db, KEY, JSON.stringify(meta));
    audit(ctx, req, 'vault_rekey', 'vault');
    return { ok: true };
  });

  const eventBody = z.object({ action: z.enum(['reveal', 'copy', 'export', 'import']), count: z.number().int().min(0).optional(), label: z.string().max(200).optional() });

  /** Records secret views in the audit log (the browser decrypts, so it reports these). */
  app.post('/api/vault/events', async (req) => {
    const body = eventBody.parse(req.body);
    const { itemId } = z.object({ itemId: z.string().max(64).optional() }).parse(req.body);
    if (itemId && !getRow(ctx, 'vault_item', itemId)) throw new HttpError(404, 'Запись не найдена');
    const summary = body.label ?? (body.count !== undefined ? `${body.count} записей` : null);
    audit(ctx, req, body.action, 'vault_item', itemId ?? null, summary);
    return { ok: true };
  });
}
