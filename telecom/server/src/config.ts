import path from 'node:path';

export interface Config {
  dataDir: string;
  /** Optional SQLite encryption key (hex). Empty means a plain database. */
  dbKey: string;
  port: number;
  host: string;
  webDist: string | null;
  publicUrl: string;
  cookieSecure: boolean;
  trustProxy: boolean;
  logLevel: string;
  /** Bobobank: internal URL (docker network), public URL (the consent page) and the partner HMAC secret. */
  bankInternalUrl: string;
  bankPublicUrl: string;
  bankSecret: string;
  /** Length of a paid period in days (30 by default). */
  periodDays: number;
}

const HEX = /^[0-9a-f]{32,128}$/i;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dbKey = env.TELECOM_DB_KEY ?? '';
  if (dbKey && !HEX.test(dbKey)) throw new Error('TELECOM_DB_KEY должен быть hex-строкой (32–128 символов). Сгенерируйте: openssl rand -hex 32');
  const port = Number(env.PORT ?? 8085);
  const publicUrl = (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, '');
  return {
    dataDir: path.resolve(env.DATA_DIR ?? './data'),
    dbKey,
    port,
    host: env.HOST ?? '0.0.0.0',
    webDist: env.WEB_DIST ? path.resolve(env.WEB_DIST) : null,
    publicUrl,
    cookieSecure: env.COOKIE_SECURE !== '0',
    trustProxy: env.TRUST_PROXY === '1',
    logLevel: env.LOG_LEVEL ?? 'info',
    bankInternalUrl: (env.BANK_INTERNAL_URL ?? '').replace(/\/$/, ''),
    bankPublicUrl: (env.BANK_PUBLIC_URL ?? env.BANK_INTERNAL_URL ?? '').replace(/\/$/, ''),
    bankSecret: env.BANK_TELECOM_SECRET ?? '',
    periodDays: Math.min(365, Math.max(1, Number(env.BILLING_PERIOD_DAYS ?? 30) || 30)),
  };
}
