import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import { registerAuth } from './auth.js';
import { HttpError, type Ctx } from './context.js';
import type { TelegramBot } from './telegram/bot.js';
import { MAX_FILE_BYTES, registerFileRoutes } from './routes/files.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerEmployeeRoutes } from './routes/employees.js';
import { registerRecordRoutes } from './routes/records.js';
import { registerRoutingRoutes } from './routes/routing.js';
import { registerTelegramRoutes } from './routes/telegram.js';
import { registerTileRoutes } from './routes/tiles.js';
import { registerVaultRoutes } from './routes/vault.js';
import { registerZerotierRoutes } from './routes/zerotier.js';

export async function buildApp(ctx: Ctx, opts: { logger?: boolean; bot?: TelegramBot } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ? { level: ctx.cfg.logLevel, redact: ['req.headers.cookie', 'req.headers.authorization'] } : false,
    // Exactly one reverse proxy (Caddy or nginx) sits in front; trust only its X-Forwarded-For hop.
    trustProxy: ctx.cfg.trustProxy ? (_addr: string, hop: number) => hop < 1 : false,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // Map tiles are proxied through /api/tiles, so images stay same-origin.
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: ctx.cfg.cookieSecure ? [] : null,
      },
    },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginEmbedderPolicy: false,
    hsts: ctx.cfg.cookieSecure ? { maxAge: 31536000 } : false,
  });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 10 } });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.code(400).send({ error: first ? `${first.path.join('.') || 'данные'}: ${first.message}` : 'Некорректные данные', issues: err.issues });
    }
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    const e = err as { statusCode?: number; message?: string; code?: string };
    if (e.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: 'Файл больше 20 МБ' });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Внутренняя ошибка сервера' });
  });

  app.get('/api/health', async () => ({ ok: true }));

  registerAuth(app, ctx);
  registerEmployeeRoutes(app, ctx);
  registerZerotierRoutes(app, ctx);
  registerAdminRoutes(app, ctx);
  registerRecordRoutes(app, ctx);
  registerRoutingRoutes(app, ctx);
  registerFileRoutes(app, ctx);
  registerVaultRoutes(app, ctx);
  registerTelegramRoutes(app, ctx, opts.bot);
  registerTileRoutes(app, ctx);

  const webDist = ctx.cfg.webDist;
  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    // serve: false — only decorate reply.sendFile; the handler below decides caching and SPA fallback.
    await app.register(fastifyStatic, { root: webDist, serve: false });
    const indexHtml = fs.readFileSync(path.join(webDist, 'index.html'));
    app.get('/*', async (req, reply) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      if (rel.startsWith('api/')) return reply.code(404).send({ error: 'Не найдено' });
      const file = path.join(webDist, rel);
      if (rel && file.startsWith(webDist + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        // Hashed build assets never change; everything else is revalidated.
        return rel.startsWith('assets/') ? reply.sendFile(rel, { maxAge: '365d', immutable: true }) : reply.sendFile(rel, { maxAge: 0 });
      }
      // A missing build file must not get index.html: an old tab would try to run HTML as JS and crash.
      if (rel.startsWith('assets/')) return reply.code(404).header('Cache-Control', 'no-store').send({ error: 'Не найдено' });
      return reply.header('Cache-Control', 'no-cache').type('text/html').send(indexHtml);
    });
  }

  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'Не найдено' }));
  return app;
}
