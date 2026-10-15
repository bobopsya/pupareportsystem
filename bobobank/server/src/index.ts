import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createCtx } from './context.js';
import { openDb } from './db.js';
import { processOrders, recheckPeople } from './domain/gos.js';
import { marketTick, TICK_MS } from './domain/market.js';
import { tick } from './domain/tick.js';

const cfg = loadConfig();
const db = openDb(cfg.dataDir, cfg.dbKey);
const ctx = createCtx(db, cfg);
const app = await buildApp(ctx, { logger: true });

// Time-driven work: confirmation timeouts, holds, interest, loan payments, tariffs.
setInterval(() => {
  try {
    tick(ctx);
  } catch (err) {
    app.log.error(err);
  }
}, 2000).unref();

// Stock prices: a step every 5 seconds.
setInterval(() => {
  try {
    marketTick(ctx);
  } catch (err) {
    app.log.error(err);
  }
}, TICK_MS).unref();

// Бобуслуги: orders from the state (arrests, salaries) and a daily passport re-check.
let gosBusy = false;
setInterval(async () => {
  if (gosBusy) return;
  gosBusy = true;
  try {
    await processOrders(ctx);
    await recheckPeople(ctx);
  } catch (err) {
    app.log.warn({ err }, 'Бобуслуги: обмен не удался');
  } finally {
    gosBusy = false;
  }
}, 15_000).unref();

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: cfg.port, host: cfg.host });
