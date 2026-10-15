import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createCtx } from './context.js';
import { openDb } from './db.js';
import { pruneGeoCache } from './domain/maps.js';
import { tick } from './domain/rides.js';

const cfg = loadConfig();
const db = openDb(cfg.dataDir, cfg.dbKey);
const ctx = createCtx(db, cfg);
const app = await buildApp(ctx, { logger: true });

// Rides move through their stages by time; holds are captured or released.
let running = false;
setInterval(() => {
  if (running) return;
  running = true;
  tick(ctx)
    .catch((err) => app.log.error(err))
    .finally(() => (running = false));
}, 2000).unref();
setInterval(() => pruneGeoCache(ctx), 6 * 3600_000).unref();

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: cfg.port, host: cfg.host });
