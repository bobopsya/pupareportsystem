import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createCtx } from './context.js';
import { openDb } from './db.js';
import { tickBank } from './domain/bankpay.js';
import { tick } from './domain/payments.js';
import { deliverDue } from './domain/webhooks.js';

const cfg = loadConfig();
const db = openDb(cfg.dataDir, cfg.dbKey);
const ctx = createCtx(db, cfg);
const app = await buildApp(ctx, { logger: true });

// Time-driven transitions (async methods, expiry, payouts) and webhook delivery.
setInterval(() => {
  try {
    tick(ctx);
  } catch (err) {
    app.log.error(err);
  }
  deliverDue(ctx).catch((err) => app.log.error(err));
  tickBank(ctx).catch((err) => app.log.error(err));
}, 2000).unref();

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: cfg.port, host: cfg.host });
