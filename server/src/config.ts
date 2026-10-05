import path from 'node:path';

export interface Config {
  dataDir: string;
  dbKey: string;
  filesKey: string;
  port: number;
  host: string;
  webDist: string | null;
  cookieSecure: boolean;
  trustProxy: boolean;
  ztApiUrl: string;
  osrmUrl: string;
  tgApiUrl: string;
  logLevel: string;
}

const HEX = /^[0-9a-f]{32,128}$/i;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dbKey = env.DB_KEY ?? '';
  const filesKey = env.FILES_KEY ?? '';
  if (!HEX.test(dbKey)) throw new Error('DB_KEY должен быть hex-строкой (32–128 символов). Сгенерируйте: openssl rand -hex 32');
  if (!HEX.test(filesKey)) throw new Error('FILES_KEY должен быть hex-строкой (32–128 символов). Сгенерируйте: openssl rand -hex 32');
  return {
    dataDir: path.resolve(env.DATA_DIR ?? './data'),
    dbKey,
    filesKey,
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    webDist: env.WEB_DIST ? path.resolve(env.WEB_DIST) : null,
    cookieSecure: env.COOKIE_SECURE !== '0',
    trustProxy: env.TRUST_PROXY === '1',
    ztApiUrl: (env.ZT_API_URL ?? 'https://api.zerotier.com/api/v1').replace(/\/$/, ''),
    osrmUrl: (env.OSRM_URL ?? 'https://router.project-osrm.org').replace(/\/$/, ''),
    tgApiUrl: (env.TG_API_URL ?? 'https://api.telegram.org').replace(/\/$/, ''),
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}
