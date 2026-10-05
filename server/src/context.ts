import type { FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import type { DB } from './db.js';
import { ServerCrypto } from './crypto.js';

export interface SessionUser {
  id: string;
  login: string;
  fullName: string;
  mustChange: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export interface Ctx {
  db: DB;
  cfg: Config;
  fileCrypto: ServerCrypto;
  secretCrypto: ServerCrypto;
  now: () => number;
  /** Outbound HTTP (Telegram). Replaced in tests. */
  http: (url: string, init: RequestInit) => Promise<Response>;
}

export function createCtx(db: DB, cfg: Config, now: () => number = Date.now): Ctx {
  return {
    db,
    cfg,
    fileCrypto: new ServerCrypto(cfg.filesKey, 'files'),
    secretCrypto: new ServerCrypto(cfg.filesKey, 'settings'),
    now,
    http: (url, init) => fetch(url, init),
  };
}

export type AuditAction =
  | 'login' | 'login_fail' | 'logout' | 'password_change' | 'password_reset'
  | 'create' | 'update' | 'delete' | 'restore' | 'purge'
  | 'reveal' | 'copy' | 'import' | 'export'
  | 'sync' | 'backup' | 'vault_init' | 'vault_rekey' | 'settings' | 'checkin' | 'tg_link' | 'tg_unlink';

export function audit(
  ctx: Ctx,
  req: FastifyRequest | null,
  action: AuditAction,
  entity: string | null = null,
  entityId: string | null = null,
  summary: string | null = null,
  userOverride?: { id: string | null; login: string | null },
) {
  const user = userOverride ?? (req?.user ? { id: req.user.id, login: req.user.login } : { id: null, login: null });
  ctx.db
    .prepare('INSERT INTO audit(ts, user_id, user_login, action, entity, entity_id, summary, ip) VALUES(?,?,?,?,?,?,?,?)')
    .run(ctx.now(), user.id, user.login, action, entity, entityId, summary?.slice(0, 500) ?? null, req?.ip ?? null);
}

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}
