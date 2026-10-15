import type { FastifyInstance, FastifyReply } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Ctx } from '../context.js';
import { getGlobalFees, METHOD_TITLE, METHODS } from '../domain/fees.js';
import { MODES, SUBJECTS, VAT_CODES } from '../domain/receipts.js';
import { EVENTS } from '../domain/webhooks.js';

/** Integration guide for AI agents, following the llms.txt convention. */
const GUIDE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'llms-full.md');

const codes = (list: readonly string[]) => list.map((c) => `\`${c}\``).join(', ');

export function renderLlmsFull(ctx: Ctx): string {
  const base = ctx.cfg.publicUrl.replace(/\/+$/, '');
  const fees = getGlobalFees(ctx.db);
  const vars: Record<string, string> = {
    BASE: base,
    HOST: new URL(base).host,
    VAT: codes(VAT_CODES),
    SUBJECTS: codes(Object.keys(SUBJECTS)),
    MODES: codes(Object.keys(MODES)),
    EVENTS: codes(EVENTS),
    FEES: ['| Способ (`payment_method.type`) | Комиссия |', '|---|---|', ...METHODS.map((m) => `| ${METHOD_TITLE[m]} (\`${m}\`) | ${String(fees[m]).replace('.', ',')}% |`)].join('\n'),
  };
  return fs.readFileSync(GUIDE, 'utf8').replace(/\{\{([A-Z]+)\}\}/g, (all, k: string) => vars[k] ?? all);
}

export function renderLlmsIndex(ctx: Ctx): string {
  const base = ctx.cfg.publicUrl.replace(/\/+$/, '');
  return `# GPAY

> GPAY (GnusaPay) — платёжный сервис: приём оплаты деньгами игрового банка Bobobank — картой, через СБП и Bobo Pay; онлайн-касса с чеками, ссылки на оплату, REST API в стиле ЮKassa, вебхуки с подписью HMAC-SHA256 и виджет для сайтов.

ИИ-агент, которому поручили подключить оплату GPAY: прочитай полную инструкцию — она самодостаточна и содержит пошаговую интеграцию, справочник API, проверку вебхуков, готовый код на Node.js, Python и PHP и чек-лист.

## Инструкция

- [Полная инструкция для ИИ-агентов](${base}/llms-full.txt): всё, что нужно для интеграции, одним файлом в Markdown

## Ссылки

- [REST API](${base}/api/v1): базовый URL, авторизация \`Authorization: Bearer sk_live_…\`, на каждый POST — заголовок \`Idempotence-Key\`
- [Документация с песочницей](${base}/docs): та же информация для людей, с примерами и отправкой запросов
- [Виджет](${base}/gpay.js): \`GPAY.checkout({ paymentId })\` — оплата во всплывающем окне
- [Кабинет продавца](${base}/app): API-ключи, вебхуки, журнал запросов и доставок
`;
}

export function registerLlmsRoutes(app: FastifyInstance, ctx: Ctx) {
  const text = (reply: FastifyReply, body: string) =>
    reply.type('text/plain; charset=utf-8').header('Cache-Control', 'no-cache').header('access-control-allow-origin', '*').send(body);
  app.get('/llms.txt', (_req, reply) => text(reply, renderLlmsIndex(ctx)));
  app.get('/llms-full.txt', (_req, reply) => text(reply, renderLlmsFull(ctx)));
}
