import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createCtx } from './context.js';
import { openDb } from './db.js';
import { purgeExpired } from './routes/admin.js';
import { TelegramBot } from './telegram/bot.js';
import { runSchedule } from './telegram/checkins.js';

const cfg = loadConfig();
const db = openDb(cfg.dataDir, cfg.dbKey);
const ctx = createCtx(db, cfg);
const bot = new TelegramBot(ctx, (msg) => app.log.warn(msg));
const app = await buildApp(ctx, { logger: true, bot });

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

// Telegram: long polling for the bot plus a once-a-minute check for reminders and missed check-ins.
bot.start();
let scheduleBusy = false;
setInterval(async () => {
  if (scheduleBusy) return;
  scheduleBusy = true;
  try {
    const r = await runSchedule(ctx);
    if (r.reported) app.log.info(`Telegram: в канал отправлено ${r.reported} сообщений о пропущенной отметке`);
  } catch (err) {
    app.log.error(err);
  } finally {
    scheduleBusy = false;
  }
}, 60_000).unref();

const shutdown = async () => {
  bot.stop();
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: cfg.port, host: cfg.host });
