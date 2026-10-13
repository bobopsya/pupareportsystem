import path from 'node:path';

export interface Config {
  dataDir: string;
  /** Optional SQLite encryption key (hex). Empty means a plain database. */
  dbKey: string;
  port: number;
  host: string;
  webDist: string | null;
  /** Public origin used in confirmation_url, receipt links and QR codes. */
  publicUrl: string;
  cookieSecure: boolean;
  trustProxy: boolean;
  /** Lets webhooks reach localhost/private networks (local development only). */
  webhookAllowPrivate: boolean;
  logLevel: string;
}

const HEX = /^[0-9a-f]{32,128}$/i;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dbKey = env.GPAY_DB_KEY ?? '';
  if (dbKey && !HEX.test(dbKey)) throw new Error('GPAY_DB_KEY должен быть hex-строкой (32–128 символов). Сгенерируйте: openssl rand -hex 32');
  const port = Number(env.PORT ?? 8081);
  return {
    dataDir: path.resolve(env.DATA_DIR ?? './data'),
    dbKey,
    port,
    host: env.HOST ?? '0.0.0.0',
    webDist: env.WEB_DIST ? path.resolve(env.WEB_DIST) : null,
    publicUrl: (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
    cookieSecure: env.COOKIE_SECURE !== '0',
    trustProxy: env.TRUST_PROXY === '1',
    webhookAllowPrivate: env.WEBHOOK_ALLOW_PRIVATE === '1',
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}
