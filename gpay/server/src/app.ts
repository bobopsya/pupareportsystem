import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import { registerAuth } from './auth.js';
import { ApiError, HttpError, type Ctx } from './context.js';
import { seedGameCards } from './domain/cards.js';
import { registerAdminRoutes } from './routes/admin.js';
import { apiErrorBody, registerApiV1 } from './routes/api-v1.js';
import { registerBankInternalRoutes } from './routes/bank-internal.js';
import { registerCheckoutRoutes } from './routes/checkout.js';
import { registerLlmsRoutes } from './routes/llms.js';
import { registerMerchantRoutes } from './routes/merchant.js';

/** Pages that the gpay.js widget opens inside an iframe on merchant sites. */
const EMBEDDABLE = /^\/(pay|l)\//;

export async function buildApp(ctx: Ctx, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  seedGameCards(ctx.db, ctx.now());
  const app = Fastify({
    logger: opts.logger ? { level: ctx.cfg.logLevel, redact: ['req.headers.cookie', 'req.headers.authorization'] } : false,
    trustProxy: ctx.cfg.trustProxy ? (_addr: string, hop: number) => hop < 1 : false,
    bodyLimit: 512 * 1024,
  });

  // Keep the raw JSON body: Bobobank's requests are signed over the exact bytes.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body as string;
    if (!body) return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(Object.assign(new Error('Некорректный JSON'), { statusCode: 400 }), undefined);
    }
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
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: ctx.cfg.cookieSecure ? { maxAge: 31536000 } : false,
  });
  // The checkout may be framed by any merchant site (widget); everything else stays unframeable.
  app.addHook('onSend', async (req, reply, payload) => {
    if (EMBEDDABLE.test(req.url)) {
      reply.removeHeader('x-frame-options');
      const csp = String(reply.getHeader('content-security-policy') ?? '');
      reply.header('content-security-policy', csp.replace("frame-ancestors 'none'", 'frame-ancestors *'));
    }
    return payload;
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute', allowList: (req) => req.url.startsWith('/internal/') });

  app.setErrorHandler((err, req, reply) => {
    const isApi = req.url.startsWith('/api/v1/');
    if (err instanceof ApiError) return reply.code(err.statusCode).send(isApi ? apiErrorBody(err) : { error: err.message, code: err.code, parameter: err.parameter });
    if (err instanceof ZodError) {
      const first = err.issues[0];
      const msg = first ? `${first.path.join('.') || 'данные'}: ${first.message}` : 'Некорректные данные';
      return reply.code(400).send(isApi ? apiErrorBody(new ApiError(400, 'invalid_request', msg)) : { error: first?.message ?? msg, issues: err.issues });
    }
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode === 429) return reply.code(429).send(isApi ? apiErrorBody(new ApiError(429, 'too_many_requests', 'Слишком много запросов')) : { error: 'Слишком много запросов, подождите минуту' });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send(isApi ? apiErrorBody(new ApiError(e.statusCode, 'invalid_request', e.message ?? 'Некорректный запрос')) : { error: e.message });
    req.log.error(err);
    return reply.code(500).send(isApi ? apiErrorBody(new ApiError(500, 'internal_server_error', 'Внутренняя ошибка. Повторите запрос с тем же Idempotence-Key.')) : { error: 'Внутренняя ошибка сервера' });
  });

  app.get('/api/health', async () => ({ ok: true }));

  registerAuth(app, ctx);
  registerApiV1(app, ctx);
  registerCheckoutRoutes(app, ctx);
  registerLlmsRoutes(app, ctx);
  registerBankInternalRoutes(app, ctx);
  registerMerchantRoutes(app, ctx);
  registerAdminRoutes(app, ctx);

  const webDist = ctx.cfg.webDist;
  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, serve: false });
    const indexHtml = fs.readFileSync(path.join(webDist, 'index.html'));
    app.get('/*', async (req, reply) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      if (rel.startsWith('api/') || rel.startsWith('internal/')) return reply.code(404).send({ error: 'Не найдено' });
      const file = path.join(webDist, rel);
      if (rel && file.startsWith(webDist + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        if (rel === 'gpay.js') reply.header('access-control-allow-origin', '*');
        return rel.startsWith('assets/') ? reply.sendFile(rel, { maxAge: '365d', immutable: true }) : reply.sendFile(rel, { maxAge: 0 });
      }
      if (rel.startsWith('assets/')) return reply.code(404).header('Cache-Control', 'no-store').send({ error: 'Не найдено' });
      return reply.header('Cache-Control', 'no-cache').type('text/html').send(indexHtml);
    });
  }

  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'Не найдено' }));
  return app;
}
