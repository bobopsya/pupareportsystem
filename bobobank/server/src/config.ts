import path from 'node:path';

export interface Config {
  dataDir: string;
  /** Optional SQLite encryption key (hex). Empty means a plain database. */
  dbKey: string;
  port: number;
  host: string;
  webDist: string | null;
  /** Public origin of the bank (links in PDFs, SBP pages). */
  publicUrl: string;
  cookieSecure: boolean;
  trustProxy: boolean;
  logLevel: string;
  /** GPAY integration: internal URL (docker network), public URL (links for customers) and the shared HMAC secret. */
  gpayInternalUrl: string;
  gpayPublicUrl: string;
  gpaySecret: string;
  /** Бобуслуги (Supabase): the server key stays on the server; the public URL is where people sign in. */
  supabaseUrl: string;
  supabaseServiceKey: string;
  supabaseAnonKey: string;
  gosPublicUrl: string;
}

const HEX = /^[0-9a-f]{32,128}$/i;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dbKey = env.BANK_DB_KEY ?? '';
  if (dbKey && !HEX.test(dbKey)) throw new Error('BANK_DB_KEY должен быть hex-строкой (32–128 символов). Сгенерируйте: openssl rand -hex 32');
  const port = Number(env.PORT ?? 8082);
  return {
    dataDir: path.resolve(env.DATA_DIR ?? './data'),
    dbKey,
    port,
    host: env.HOST ?? '0.0.0.0',
    webDist: env.WEB_DIST ? path.resolve(env.WEB_DIST) : null,
    publicUrl: (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
    cookieSecure: env.COOKIE_SECURE !== '0',
    trustProxy: env.TRUST_PROXY === '1',
    logLevel: env.LOG_LEVEL ?? 'info',
    gpayInternalUrl: (env.GPAY_INTERNAL_URL ?? '').replace(/\/$/, ''),
    gpayPublicUrl: (env.GPAY_PUBLIC_URL ?? env.GPAY_INTERNAL_URL ?? '').replace(/\/$/, ''),
    gpaySecret: env.BANK_GPAY_SECRET ?? '',
    supabaseUrl: (env.SUPABASE_URL ?? '').replace(/\/$/, ''),
    supabaseServiceKey: env.SUPABASE_SERVICE_KEY ?? '',
    supabaseAnonKey: env.SUPABASE_ANON_KEY ?? '',
    gosPublicUrl: (env.GOS_PUBLIC_URL ?? '').replace(/\/$/, ''),
  };
}
