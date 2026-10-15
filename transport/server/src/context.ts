import type { Config } from './config.js';
import type { DB } from './db.js';

export interface SessionUser {
  id: string;
  name: string;
  role: 'rider' | 'admin';
  mandateId: string | null;
  accountLast4: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    rawBody?: string;
  }
}

export interface Ctx {
  db: DB;
  cfg: Config;
  now: () => number;
  /** Random numbers in [0, 1): replaced in tests for stable cars and surge. */
  random: () => number;
  /** Outbound HTTP to Bobobank. Replaced in tests. */
  bankHttp: (url: string, init: RequestInit) => Promise<Response>;
  /** Outbound HTTP to OSRM and Nominatim. Replaced in tests. */
  geoHttp: (url: string, init: RequestInit) => Promise<Response>;
}

export function createCtx(db: DB, cfg: Config, now: () => number = Date.now): Ctx {
  return { db, cfg, now, random: Math.random, bankHttp: (url, init) => fetch(url, init), geoHttp: (url, init) => fetch(url, init) };
}

export class HttpError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message);
  }
}
