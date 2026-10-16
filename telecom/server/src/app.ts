import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import { registerAuth } from './auth.js';
import { HttpError, type Ctx } from './context.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerGosRoutes } from './routes/gos.js';
import { registerTelecomRoutes } from './routes/telecom.js';

export async function buildApp(ctx: Ctx, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ? { level: ctx.cfg.logLevel, redact: ['req.headers.cookie'] } : false,
    trustProxy: ctx.cfg.trustProxy ? (_addr: string, hop: number) => hop < 1 : false,
    bodyLimit: 256 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
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
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
    hsts: ctx.cfg.cookieSecure ? { maxAge: 31536000 } : false,
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message, code: err.code });
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.code(400).send({ error: first ? `${first.path.join('.') || 'данные'}: ${first.message}` : 'Некорректные данные' });
    }
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode === 429) return reply.code(429).send({ error: 'Слишком много запросов, подождите минуту' });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Внутренняя ошибка сервера' });
  });

  app.get('/api/health', async () => ({ ok: true }));
  registerAuth(app, ctx);
  registerTelecomRoutes(app, ctx);
  registerGosRoutes(app, ctx);
  registerAdminRoutes(app, ctx);

  const webDist = ctx.cfg.webDist;
  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, serve: false });
    const indexHtml = fs.readFileSync(path.join(webDist, 'index.html'));
    app.get('/*', async (req, reply) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      if (rel.startsWith('api/')) return reply.code(404).send({ error: 'Не найдено' });
      const file = path.join(webDist, rel);
      if (rel && file.startsWith(webDist + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        return rel.startsWith('assets/') ? reply.sendFile(rel, { maxAge: '365d', immutable: true }) : reply.sendFile(rel, { maxAge: 0 });
      }
      if (rel.startsWith('assets/')) return reply.code(404).header('Cache-Control', 'no-store').send({ error: 'Не найдено' });
      return reply.header('Cache-Control', 'no-cache').type('text/html').send(indexHtml);
    });
  }

  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'Не найдено' }));
  return app;
}
