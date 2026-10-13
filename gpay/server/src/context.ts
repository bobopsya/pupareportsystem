import type { FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import type { Config } from './config.js';
import { getSetting, setSetting, type DB } from './db.js';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'merchant' | 'admin';
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export interface Ctx {
  db: DB;
  cfg: Config;
  now: () => number;
  /** Outbound HTTP for webhooks. Replaced in tests. */
  http: (url: string, init: RequestInit) => Promise<Response>;
  /** Server secret for fiscal signatures (ФПД) and similar derived values. */
  secret: string;
}

export function createCtx(db: DB, cfg: Config, now: () => number = Date.now): Ctx {
  let secret = getSetting<string>(db, 'server_secret', '');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    setSetting(db, 'server_secret', secret);
  }
  return { db, cfg, now, http: (url, init) => fetch(url, init), secret };
}

export function audit(ctx: Ctx, req: FastifyRequest | null, action: string, entity: string | null = null, entityId: string | null = null, summary: string | null = null) {
  const u = req?.user;
  ctx.db
    .prepare('INSERT INTO audit(ts, user_id, user_email, action, entity, entity_id, summary, ip) VALUES(?,?,?,?,?,?,?,?)')
    .run(ctx.now(), u?.id ?? null, u?.email ?? null, action, entity, entityId, summary?.slice(0, 500) ?? null, req?.ip ?? null);
}

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

/** Error in the public API format: { type: 'error', code, description, parameter }. */
export class ApiError extends Error {
  constructor(public statusCode: number, public code: string, description: string, public parameter?: string) {
    super(description);
  }
}
