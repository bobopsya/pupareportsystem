import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createCtx } from './context.js';
import { openDb } from './db.js';
import { purgeExpired } from './routes/admin.js';

const cfg = loadConfig();
const db = openDb(cfg.dataDir, cfg.dbKey);
const ctx = createCtx(db, cfg);
const app = await buildApp(ctx, { logger: true });

const runPurge = () => {
  try {
    const n = purgeExpired(ctx);
    if (n) app.log.info(`Корзина: окончательно удалено ${n} записей старше 30 дней`);
  } catch (err) {
    app.log.error(err);
  }
};
runPurge();
setInterval(runPurge, 6 * 60 * 60 * 1000).unref();

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: cfg.port, host: cfg.host });
