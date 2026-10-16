import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createCtx } from './context.js';
import { openDb } from './db.js';
import { tickCalls } from './domain/comm.js';
import { syncLinks } from './domain/gos.js';
import { tick } from './domain/lines.js';

const cfg = loadConfig();
const db = openDb(cfg.dataDir, cfg.dbKey);
const ctx = createCtx(db, cfg);
const app = await buildApp(ctx, { logger: true });

// Monthly fees, blocking for debt, simulated mobile data; unanswered calls become missed.
let running = false;
setInterval(() => {
  if (running) return;
  running = true;
  tickCalls(ctx);
  tick(ctx)
    .then(() => syncLinks(ctx))
    .catch((err) => app.log.error(err))
    .finally(() => (running = false));
}, 2000).unref();

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: cfg.port, host: cfg.host });
