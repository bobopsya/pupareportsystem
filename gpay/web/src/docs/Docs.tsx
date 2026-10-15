import { ArrowLeft, Bot, FileText, Menu, Play, RefreshCw, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { CardLogos, PayLogo } from '../components/PaymentLogos';
import { Badge, Button, CopyButton, cx, Input, Kbd, Select, Textarea } from '../components/ui';
import { useAuth } from '../lib/auth';

const ORIGIN = typeof location !== 'undefined' ? location.origin : 'https://pay.example';
const BASE = `${ORIGIN}/api/v1`;

const SECTIONS = [
  { id: 'start', title: 'Быстрый старт' },
  { id: 'ai', title: 'ИИ-агентам' },
  { id: 'auth', title: 'Аутентификация' },
  { id: 'idempotency', title: 'Идемпотентность' },
  { id: 'payments', title: 'Платежи' },
  { id: 'statuses', title: 'Статусы платежа' },
  { id: 'capture', title: 'Двухстадийная оплата' },
  { id: 'refunds', title: 'Возвраты' },
  { id: 'receipts', title: 'Чеки (54-ФЗ)' },
  { id: 'links', title: 'Ссылки на оплату' },
  { id: 'payouts', title: 'Выплаты' },
  { id: 'webhooks', title: 'Вебхуки' },
  { id: 'widget', title: 'Виджет оплаты' },
  { id: 'cards', title: 'Как проверить оплату' },
  { id: 'errors', title: 'Ошибки' },
  { id: 'sandbox', title: 'Песочница' },
];

// ---------- Code blocks ----------
type Lang = 'curl' | 'node' | 'python' | 'php';
const LANGS: { id: Lang; label: string }[] = [
  { id: 'curl', label: 'cURL' },
  { id: 'node', label: 'Node.js' },
  { id: 'python', label: 'Python' },
  { id: 'php', label: 'PHP' },
];

let langListeners: ((l: Lang) => void)[] = [];
let currentLang: Lang = (typeof localStorage !== 'undefined' && (localStorage.getItem('gpay.lang') as Lang)) || 'curl';
function useLang(): [Lang, (l: Lang) => void] {
  const [l, setL] = useState(currentLang);
  useEffect(() => {
    langListeners.push(setL);
    return () => void (langListeners = langListeners.filter((f) => f !== setL));
  }, []);
  return [l, (x) => {
    currentLang = x;
    try {
      localStorage.setItem('gpay.lang', x);
    } catch {
      /* private mode */
    }
    langListeners.forEach((f) => f(x));
  }];
}

function Code({ children, title, wrap }: { children: string; title?: ReactNode; wrap?: boolean }) {
  return (
    <div className="rounded-xl bg-sunken text-fg overflow-hidden ">
      {title && (
        <div className="flex items-center justify-between px-4 h-9 border-b border-line text-[13px] text-muted">
          <span>{title}</span>
          <CopyButton text={children} />
        </div>
      )}
      <pre className={cx('p-4 text-[12.5px] leading-relaxed font-mono', wrap ? 'whitespace-pre-wrap break-words' : 'overflow-x-auto')}>{children}</pre>
    </div>
  );
}

function MultiCode({ samples }: { samples: Record<Lang, string> }) {
  const [lang, setLang] = useLang();
  return (
    <div className="rounded-xl bg-sunken text-fg overflow-hidden ">
      <div className="flex items-center justify-between pl-2 pr-1 h-10 border-b border-line">
        <div className="flex">
          {LANGS.map((l) => (
            <button key={l.id} type="button" onClick={() => setLang(l.id)} className={cx('h-10 px-3 text-xs border-b-2 -mb-px', lang === l.id ? 'border-fg text-fg font-medium' : 'border-transparent text-muted hover:text-fg')}>
              {l.label}
            </button>
          ))}
        </div>
        <CopyButton text={samples[lang]} />
      </div>
      <pre className="p-4 text-[12.5px] leading-relaxed font-mono overflow-x-auto">{samples[lang]}</pre>
    </div>
  );
}

function req(method: 'GET' | 'POST', path: string, body?: object): Record<Lang, string> {
  const json = body ? JSON.stringify(body, null, 2) : '';
  const post = method === 'POST';
  return {
    curl: `curl ${post ? '-X POST ' : ''}${BASE}${path} \\\n  -H "Authorization: Bearer $GPAY_SECRET_KEY"${post ? ` \\\n  -H "Idempotence-Key: $(uuidgen)" \\\n  -H "Content-Type: application/json" \\\n  -d '${json}'` : ''}`,
    node: `const res = await fetch('${BASE}${path}', {
  method: '${method}',
  headers: {
    Authorization: \`Bearer \${process.env.GPAY_SECRET_KEY}\`,${post ? `\n    'Idempotence-Key': crypto.randomUUID(),\n    'Content-Type': 'application/json',` : ''}
  },${post ? `\n  body: JSON.stringify(${json.replace(/\n/g, '\n  ')}),` : ''}
});
const data = await res.json();`,
    python: `import os, uuid, requests

res = requests.${method.toLowerCase()}(
    "${BASE}${path}",
    headers={
        "Authorization": f"Bearer {os.environ['GPAY_SECRET_KEY']}",${post ? `\n        "Idempotence-Key": str(uuid.uuid4()),` : ''}
    },${post ? `\n    json=${json.replace(/true/g, 'True').replace(/false/g, 'False').replace(/\n/g, '\n    ')},` : ''}
)
data = res.json()`,
    php: `<?php
$ch = curl_init('${BASE}${path}');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,${post ? `\n    CURLOPT_POST => true,\n    CURLOPT_POSTFIELDS => json_encode(${phpArray(body)}),` : ''}
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . getenv('GPAY_SECRET_KEY'),${post ? `\n        'Idempotence-Key: ' . bin2hex(random_bytes(16)),\n        'Content-Type: application/json',` : ''}
    ],
]);
$data = json_decode(curl_exec($ch), true);`,
  };
}

function phpArray(v: unknown, ind = '    '): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return `'${v.replace(/'/g, "\\'")}'`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[\n${v.map((x) => `${ind}    ${phpArray(x, ind + '    ')}`).join(',\n')}\n${ind}]`;
  return `[\n${Object.entries(v as object).map(([k, x]) => `${ind}    '${k}' => ${phpArray(x, ind + '    ')}`).join(',\n')}\n${ind}]`;
}

// ---------- Layout pieces ----------
function H2({ id, children }: { id: string; children: ReactNode }) {
  return <h2 id={id} className="scroll-mt-20 text-2xl font-semibold tracking-tight pt-12 first:pt-0">{children}</h2>;
}
function P({ children }: { children: ReactNode }) {
  return <p className="text-[15px] leading-relaxed text-muted mt-3">{children}</p>;
}
function Endpoint({ method, path }: { method: string; path: string }) {
  return (
    <div className="mt-4 inline-flex max-w-full items-baseline gap-2 rounded-lg bg-sunken px-2.5 py-1.5 font-mono text-[13px]">
      <span className={cx('font-semibold shrink-0', method === 'GET' ? 'text-info' : 'text-ok')}>{method}</span>
      <span className="break-all">/api/v1{path}</span>
    </div>
  );
}
function Params({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="mt-4 rounded-2xl border border-line divide-y divide-line text-sm">
      {rows.map(([name, type, text]) => (
        // Stacked on phones (name over description), three columns from sm up.
        <div key={name} className="px-4 py-3 flex flex-col gap-1 sm:grid sm:grid-cols-[minmax(0,auto)_auto_minmax(0,1fr)] sm:gap-4">
          <span className="flex items-baseline gap-2 sm:contents">
            <span className="font-mono text-[13px] break-all">{name}</span>
            <span className="text-xs text-faint whitespace-nowrap">{type}</span>
          </span>
          <span className="text-muted">{text}</span>
        </div>
      ))}
    </div>
  );
}
function Two({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 xl:gap-8 items-start">
      <div className="min-w-0">{left}</div>
      <div className="min-w-0 xl:sticky xl:top-20 flex flex-col gap-3 mt-4 xl:mt-0">{right}</div>
    </div>
  );
}

const AGENT_PROMPT = `Подключи приём оплаты через GPAY к этому проекту.

Сначала полностью прочитай инструкцию для ИИ-агентов:
${ORIGIN}/llms-full.txt

Что нужно сделать:
1. Создание платежа на сервере (POST /api/v1/payments с Idempotence-Key) и переход покупателя на confirmation_url.
2. Обработчик вебхука с проверкой подписи GPAY-Signature; заказ считается оплаченным только по payment.succeeded.
3. Страница возврата return_url, которая показывает статус заказа.

Ключи бери из переменных окружения GPAY_SECRET_KEY и GPAY_WEBHOOK_SECRET, в код их не вписывай.
Проверь оплату картой Bobobank (деньги на счёт начисляет администратор банка).`;

const PAYMENT_EXAMPLE = {
  amount: { value: '1290.00', currency: 'RUB' },
  capture: true,
  description: 'Заказ №4821',
  confirmation: { type: 'redirect', return_url: 'https://shop.ru/thanks' },
  metadata: { order_id: '4821' },
  receipt: {
    customer: { email: 'ivan@mail.ru' },
    items: [{ description: 'Капучино 0,4 л', quantity: 2, amount: { value: '320.00', currency: 'RUB' }, vat_code: 'vat22', payment_subject: 'commodity', payment_mode: 'full_payment' }, { description: 'Круассан', quantity: 1, amount: { value: '650.00', currency: 'RUB' }, vat_code: 'vat10' }],
  },
};

const PAYMENT_RESPONSE = `{
  "id": "pay_4bX9qLmT2sR7vKc1Nw8YhPzE",
  "status": "pending",
  "paid": false,
  "amount": { "value": "1290.00", "currency": "RUB" },
  "description": "Заказ №4821",
  "recipient": { "account_id": "412038", "gateway_id": "41203801" },
  "created_at": "2026-10-13T09:00:00.000Z",
  "expires_at": "2026-10-13T10:00:00.000Z",
  "confirmation": {
    "type": "redirect",
    "confirmation_url": "${ORIGIN}/pay/pay_4bX9qLmT2sR7vKc1Nw8YhPzE",
    "return_url": "https://shop.ru/thanks"
  },
  "test": false,
  "refundable": false,
  "receipt_registration": "pending",
  "metadata": { "order_id": "4821" }
}`;

const WEBHOOK_VERIFY: Record<Lang, string> = {
  curl: `# Подпись: GPAY-Signature: t=<unix>,v1=<hex>
# v1 = HMAC_SHA256(secret, "<t>.<raw body>")
echo -n "$T.$BODY" | openssl dgst -sha256 -hmac "$WHSEC"`,
  node: `import crypto from 'node:crypto';
import express from 'express';

const app = express();
app.post('/gpay/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const header = req.get('GPAY-Signature') ?? '';
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const expected = crypto.createHmac('sha256', process.env.GPAY_WEBHOOK_SECRET)
    .update(\`\${t}.\${req.body}\`).digest('hex');
  const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300;
  if (!fresh || !crypto.timingSafeEqual(Buffer.from(v1 ?? ''), Buffer.from(expected))) {
    return res.sendStatus(400);
  }
  const { event, object } = JSON.parse(req.body);
  if (event === 'payment.succeeded') markOrderPaid(object.metadata.order_id);
  res.sendStatus(200);
});`,
  python: `import hmac, hashlib, time
from flask import Flask, request, abort

app = Flask(__name__)

@app.post("/gpay/webhook")
def gpay_webhook():
    parts = dict(p.split("=", 1) for p in request.headers.get("GPAY-Signature", "").split(","))
    body = request.get_data()
    expected = hmac.new(SECRET.encode(), f"{parts['t']}.".encode() + body, hashlib.sha256).hexdigest()
    if abs(time.time() - int(parts["t"])) > 300 or not hmac.compare_digest(expected, parts.get("v1", "")):
        abort(400)
    event = request.get_json()
    if event["event"] == "payment.succeeded":
        mark_order_paid(event["object"]["metadata"]["order_id"])
    return "", 200`,
  php: `<?php
$body = file_get_contents('php://input');
parse_str(str_replace(',', '&', $_SERVER['HTTP_GPAY_SIGNATURE'] ?? ''), $sig);
$expected = hash_hmac('sha256', $sig['t'] . '.' . $body, getenv('GPAY_WEBHOOK_SECRET'));
if (abs(time() - (int)$sig['t']) > 300 || !hash_equals($expected, $sig['v1'] ?? '')) {
    http_response_code(400);
    exit;
}
$event = json_decode($body, true);
if ($event['event'] === 'payment.succeeded') {
    markOrderPaid($event['object']['metadata']['order_id']);
}
http_response_code(200);`,
};

export default function Docs() {
  const { user } = useAuth();
  const [nav, setNav] = useState(false);
  const [active, setActive] = useState('start');

  useEffect(() => {
    document.title = 'Документация API — GPAY';
    const obs = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setActive(vis.target.id);
    }, { rootMargin: '-80px 0px -70% 0px' });
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    });
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
    return () => obs.disconnect();
  }, []);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 h-14 bg-bg/85 backdrop-blur border-b border-line">
        <div className="h-full max-w-[1400px] mx-auto px-4 sm:px-6 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button type="button" className="lg:hidden flex size-9 items-center justify-center rounded-lg hover:bg-hover" onClick={() => setNav(true)} aria-label="Разделы"><Menu className="size-5" /></button>
            <Link to="/"><Logo size="sm" suffix="Docs" className="[&>span:last-child]:hidden min-[400px]:[&>span:last-child]:inline" /></Link>
            <Badge tone="brand" className="hidden sm:inline-flex">API v1</Badge>
          </div>
          <Link to={user ? '/app' : '/register'}><Button size="sm" variant="primary">{user ? 'Кабинет' : 'Получить ключ'}</Button></Link>
        </div>
      </header>
      <div className="max-w-[1400px] mx-auto lg:grid lg:grid-cols-[230px_1fr]">
        {nav && <div className="lg:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setNav(false)} />}
        <aside className={cx('fixed lg:sticky top-0 lg:top-14 z-50 lg:z-auto h-dvh lg:h-[calc(100dvh-56px)] w-64 lg:w-auto overflow-y-auto bg-surface lg:bg-transparent border-r border-line lg:border-0 px-4 py-6 transition-transform lg:translate-x-0', nav ? 'translate-x-0' : '-translate-x-full')}>
          <div className="lg:hidden flex justify-end mb-2"><button type="button" onClick={() => setNav(false)} aria-label="Закрыть"><X className="size-5" /></button></div>
          {user && <Link to="/app" className="flex items-center gap-1.5 text-sm text-muted hover:text-fg mb-5"><ArrowLeft className="size-4" />В кабинет</Link>}
          <nav className="flex flex-col gap-0.5">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} onClick={() => setNav(false)} className={cx('h-8 flex items-center px-3 rounded-lg text-sm', active === s.id ? 'bg-sunken text-fg font-medium' : 'text-muted hover:text-fg hover:bg-hover')}>
                {s.title}
              </a>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 px-4 sm:px-8 lg:px-12 py-10 pb-32">
          <H2 id="start">Быстрый старт</H2>
          <Two
            left={
              <>
                <P>GPAY API — это REST API в формате JSON. Все запросы отправляются на <Kbd>{BASE}</Kbd> с сервера магазина по HTTPS.</P>
                <ol className="mt-4 flex flex-col gap-3 text-[15px] text-muted list-decimal pl-5">
                  <li>Зарегистрируйтесь и подключите магазин в <Link to="/app" className="text-brand">личном кабинете</Link>.</li>
                  <li>Выпустите секретный ключ в разделе «Разработчикам».</li>
                  <li>Создайте платёж и перенаправьте покупателя на <Kbd>confirmation.confirmation_url</Kbd>.</li>
                  <li>Получите вебхук <Kbd>payment.succeeded</Kbd> и выдайте товар.</li>
                </ol>
                <P>После оплаты покупатель вернётся на <Kbd>return_url</Kbd>. Не полагайтесь на сам факт возврата — проверяйте статус по вебхуку или запросом <Kbd>GET /payments/{'{id}'}</Kbd>.</P>
                <div className="mt-5 flex flex-wrap gap-1.5"><CardLogos /><PayLogo name="sbp" /><PayLogo name="tether" /><PayLogo name="bitcoin" /></div>
              </>
            }
            right={<MultiCode samples={req('POST', '/payments', { amount: { value: '1290.00', currency: 'RUB' }, description: 'Заказ №4821', confirmation: { type: 'redirect', return_url: 'https://shop.ru/thanks' } })} />}
          />

          <H2 id="ai">ИИ-агентам</H2>
          <Two
            left={
              <>
                <P>Интеграцию можно поручить ИИ-агенту — Claude, ChatGPT, Cursor, Copilot и другим. Для них есть отдельная инструкция в формате <Kbd>llms.txt</Kbd>: один Markdown-файл со всем необходимым — пошаговое подключение, справочник API, проверка подписи вебхука, готовый код на Node.js, Python и PHP, список карт и чек-лист. Адреса и карты в ней всегда актуальные.</P>
                <div className="mt-5 flex flex-col gap-2">
                  {[
                    { href: '/llms-full.txt', title: 'Полная инструкция', hint: 'Всё для интеграции одним файлом' },
                    { href: '/llms.txt', title: 'Краткий индекс', hint: 'Для агентов, которые сами ищут llms.txt' },
                  ].map((l) => (
                    <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3 hover:bg-hover transition-colors min-w-0">
                      <FileText className="size-5 text-brand shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-medium">{l.title}</span>
                        <span className="block text-[13px] text-muted truncate">{ORIGIN}{l.href} · {l.hint}</span>
                      </span>
                    </a>
                  ))}
                </div>
                <P>Скопируйте готовый запрос и отправьте агенту, открытому в папке вашего проекта. Секретный ключ агенту не показывайте: пусть он ждёт его в переменной окружения <Kbd>GPAY_SECRET_KEY</Kbd>, а значение вы впишете сами.</P>
              </>
            }
            right={<Code title={<span className="inline-flex items-center gap-1.5"><Bot className="size-4" />Запрос для агента</span>} wrap>{AGENT_PROMPT}</Code>}
          />

          <H2 id="auth">Аутентификация</H2>
          <Two
            left={
              <>
                <P>Передавайте секретный ключ в заголовке <Kbd>Authorization: Bearer sk_live_…</Kbd>. Также поддерживается Basic-аутентификация: логин — ID магазина, пароль — секретный ключ.</P>
                <P>Ключ даёт полный доступ к магазину. Не используйте его в браузере или мобильном приложении. Скомпрометированный ключ отзовите в кабинете — он перестанет работать мгновенно.</P>
              </>
            }
            right={<Code title="Проверка ключа">{`curl ${BASE}/me \\\n  -u 412038:sk_live_…\n\n{\n  "account_id": "412038",\n  "name": "Кофейня «Зерно»",\n  "status": "enabled",\n  "fiscalization_enabled": true,\n  "payment_methods": ["bank_card", "sbp", "bobopay"]\n}`}</Code>}
          />

          <H2 id="idempotency">Идемпотентность</H2>
          <Two
            left={
              <>
                <P>Все POST-запросы требуют заголовок <Kbd>Idempotence-Key</Kbd> — уникальную строку до 64 символов (удобно использовать UUID v4). Повторный запрос с тем же ключом в течение 24 часов вернёт сохранённый ответ и не создаст дубль.</P>
                <P>Если ключ повторяется с другим телом запроса, API вернёт ошибку <Kbd>invalid_request</Kbd>. При сетевой ошибке или ответе 500 повторите запрос с тем же ключом.</P>
              </>
            }
            right={<Code title="Повтор запроса">{`Idempotence-Key: 7d1f6c5e-1b2a-4c83-9f4e-0a2d5b8c9e11`}</Code>}
          />

          <H2 id="payments">Платежи</H2>
          <Two
            left={
              <>
                <Endpoint method="POST" path="/payments" />
                <P>Создаёт платёж. Ответ содержит ссылку на страницу оплаты GPAY, где покупатель выберет способ: карта Bobobank, СБП или Bobo Pay.</P>
                <Params
                  rows={[
                    ['amount', 'object', 'Сумма: value — строка с двумя знаками после точки, currency — RUB, USD или EUR.'],
                    ['description', 'string', 'Описание до 128 символов, покупатель увидит его на странице оплаты.'],
                    ['capture', 'boolean', 'false — двухстадийный платёж (холдирование). По умолчанию true.'],
                    ['confirmation', 'object', 'type: redirect, return_url — куда вернуть покупателя.'],
                    ['receipt', 'object', 'Данные для чека: customer.email и items. Сумма позиций должна совпадать с amount.'],
                    ['metadata', 'object', 'До 16 пар «ключ — строка». Вернётся в ответах и вебхуках.'],
                  ]}
                />
                <Endpoint method="GET" path="/payments/{id}" />
                <Endpoint method="GET" path="/payments?status=succeeded&limit=20&cursor=…" />
                <P>Список возвращается от новых к старым. Для следующей страницы передайте <Kbd>next_cursor</Kbd>.</P>
              </>
            }
            right={
              <>
                <MultiCode samples={req('POST', '/payments', PAYMENT_EXAMPLE)} />
                <Code title="Ответ">{PAYMENT_RESPONSE}</Code>
              </>
            }
          />

          <H2 id="statuses">Статусы платежа</H2>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {[
              ['pending', 'Создан и ожидает оплаты. Покупатель может сделать до 5 попыток. Через 1 час без оплаты — canceled.', 'neutral'],
              ['waiting_for_capture', 'Деньги заморожены (capture: false). Подтвердите или отмените в течение 7 дней.', 'info'],
              ['succeeded', 'Оплачен, деньги поступят на баланс магазина, чек зарегистрирован.', 'ok'],
              ['canceled', 'Отменён. Причина — в cancellation_details.reason.', 'bad'],
            ].map(([s, t, tone]) => (
              <div key={s} className="rounded-xl border border-line bg-surface p-4 shadow-card">
                <Badge tone={tone as 'ok'} className="font-mono">{s}</Badge>
                <p className="mt-2 text-sm text-muted">{t}</p>
              </div>
            ))}
          </div>
          <Params
            rows={[
              ['expired_on_confirmation', 'gpay', 'Покупатель не оплатил за отведённое время.'],
              ['too_many_attempts', 'gpay', 'Пять неудачных попыток оплаты подряд.'],
              ['expired_on_capture', 'gpay', 'Двухстадийный платёж не подтверждён за 7 дней.'],
              ['canceled_by_merchant', 'merchant', 'Магазин отменил платёж через API или кабинет.'],
            ]}
          />

          <H2 id="capture">Двухстадийная оплата</H2>
          <Two
            left={
              <>
                <P>Создайте платёж с <Kbd>capture: false</Kbd>. После оплаты он перейдёт в <Kbd>waiting_for_capture</Kbd>: деньги заморожены на карте покупателя. Спишите всю сумму или её часть, либо отмените платёж.</P>
                <Endpoint method="POST" path="/payments/{id}/capture" />
                <Endpoint method="POST" path="/payments/{id}/cancel" />
              </>
            }
            right={<MultiCode samples={req('POST', '/payments/pay_4bX9qLmT2sR7vKc1Nw8YhPzE/capture', { amount: { value: '990.00', currency: 'RUB' } })} />}
          />

          <H2 id="refunds">Возвраты</H2>
          <Two
            left={
              <>
                <Endpoint method="POST" path="/refunds" />
                <P>Полный или частичный возврат успешного платежа. Можно сделать несколько частичных возвратов, пока не будет возвращена вся сумма. Чек «Возврат прихода» формируется автоматически.</P>
                <Endpoint method="GET" path="/refunds?payment_id=…" />
                <Endpoint method="GET" path="/refunds/{id}" />
              </>
            }
            right={<MultiCode samples={req('POST', '/refunds', { payment_id: 'pay_4bX9qLmT2sR7vKc1Nw8YhPzE', amount: { value: '320.00', currency: 'RUB' }, description: 'Возврат капучино' })} />}
          />

          <H2 id="receipts">Чеки (54-ФЗ)</H2>
          <Two
            left={
              <>
                <P>Онлайн-касса GPAY регистрирует чек «Приход» при списании и «Возврат прихода» при возврате. Если receipt не передан, в чек попадёт одна позиция с описанием платежа и НДС по умолчанию из настроек магазина.</P>
                <Params
                  rows={[
                    ['vat_code', 'string', 'none, vat0, vat5, vat7, vat10, vat22, vat105, vat107, vat110, vat122'],
                    ['payment_subject', 'string', 'commodity, service, job, excise, payment, another'],
                    ['payment_mode', 'string', 'full_payment, full_prepayment, partial_prepayment, advance'],
                  ]}
                />
                <Endpoint method="GET" path="/receipts?payment_id=…" />
              </>
            }
            right={<Code title="Ответ">{`{\n  "type": "list",\n  "items": [{\n    "id": "rcp_kq8Y1sTzX0aB3cD4eF5g",\n    "type": "payment",\n    "status": "succeeded",\n    "fiscal_document_number": "57",\n    "fiscal_storage_number": "7380440512345678",\n    "fiscal_attribute": "3829105562",\n    "total": { "value": "1290.00", "currency": "RUB" },\n    "url": "${ORIGIN}/r/rcp_kq8Y1sTzX0aB3cD4eF5g"\n  }]\n}`}</Code>}
          />

          <H2 id="links">Ссылки на оплату</H2>
          <Two
            left={
              <>
                <Endpoint method="POST" path="/payment_links" />
                <P>Ссылка с фиксированной или свободной суммой (min_amount / max_amount) либо счёт (type: invoice) с позициями чека. Покупатель откроет её и оплатит любым доступным способом.</P>
              </>
            }
            right={<MultiCode samples={req('POST', '/payment_links', { title: 'Абонемент на месяц', amount: { value: '3500.00', currency: 'RUB' }, reusable: true })} />}
          />

          <H2 id="payouts">Выплаты</H2>
          <Two
            left={
              <>
                <Endpoint method="POST" path="/payouts" />
                <P>Вывод доступного баланса магазина на карту. Сумма не может превышать доступный остаток в выбранной валюте. По завершении придёт вебхук <Kbd>payout.succeeded</Kbd>.</P>
              </>
            }
            right={<MultiCode samples={req('POST', '/payouts', { amount: { value: '15000.00', currency: 'RUB' }, payout_destination: { card_last4: '4242' } })} />}
          />

          <H2 id="webhooks">Вебхуки</H2>
          <Two
            left={
              <>
                <P>Добавьте URL в кабинете («Разработчикам» → «Вебхуки»). GPAY отправит POST-запрос при событиях:</P>
                <Params
                  rows={[
                    ['payment.succeeded', 'event', 'Платёж успешно оплачен.'],
                    ['payment.waiting_for_capture', 'event', 'Двухстадийный платёж ждёт подтверждения.'],
                    ['payment.canceled', 'event', 'Платёж отменён.'],
                    ['refund.succeeded', 'event', 'Возврат выполнен.'],
                    ['payout.succeeded', 'event', 'Выплата зачислена.'],
                  ]}
                />
                <P>Каждый запрос подписан: заголовок <Kbd>GPAY-Signature: t=1760346000,v1=5f2b…</Kbd>, где v1 = HMAC-SHA256 от строки <Kbd>{'{t}.{тело запроса}'}</Kbd> с секретом эндпоинта <Kbd>whsec_…</Kbd>. Ответьте 2xx в течение 10 секунд, иначе GPAY повторит отправку через 1 мин, 5 мин, 30 мин, 2 ч, 5 ч и 16 ч.</P>
              </>
            }
            right={
              <>
                <Code title="Тело уведомления">{`{\n  "type": "notification",\n  "id": "evt_Qm3x9ZpL0aT5yB7cD1eF",\n  "event": "payment.succeeded",\n  "created_at": "2026-10-13T09:01:12.000Z",\n  "object": {\n    "id": "pay_4bX9qLmT2sR7vKc1Nw8YhPzE",\n    "status": "succeeded",\n    "paid": true,\n    "amount": { "value": "1290.00", "currency": "RUB" },\n    "income_amount": { "value": "1253.88", "currency": "RUB" },\n    "payment_method": {\n      "type": "bank_card",\n      "title": "МИР •• 0004",\n      "card": { "first6": "220000", "last4": "0004", "card_type": "МИР" }\n    },\n    "metadata": { "order_id": "4821" }\n  }\n}`}</Code>
                <MultiCode samples={WEBHOOK_VERIFY} />
              </>
            }
          />

          <H2 id="widget">Виджет оплаты</H2>
          <Two
            left={
              <>
                <P>Откройте оплату во всплывающем окне поверх вашего сайта, без перехода на другую страницу. Подключите скрипт и передайте ID платежа, созданного на сервере, или ссылку на оплату.</P>
                <Params
                  rows={[
                    ['paymentId', 'string', 'ID платежа (pay_…).'],
                    ['url', 'string', 'Либо готовая ссылка: confirmation_url или ссылка на оплату /l/….'],
                    ['onSuccess', 'function', 'Платёж оплачен или средства заморожены.'],
                    ['onFail', 'function', 'Отказ банка или отмена (вызывается на каждую неудачную попытку).'],
                    ['onClose', 'function', 'Покупатель закрыл окно.'],
                  ]}
                />
                <P>Кнопка без JavaScript: <Kbd>{'<gpay-button payment-id="pay_…">'}</Kbd>.</P>
              </>
            }
            right={<Code title="index.html">{`<script src="${ORIGIN}/gpay.js" async></script>

<button id="pay">Оплатить</button>
<script>
  document.getElementById('pay').onclick = async () => {
    const { id } = await fetch('/create-payment', { method: 'POST' }).then((r) => r.json());
    GPAY.checkout({
      paymentId: id,
      onSuccess: (e) => location.href = '/thanks?payment=' + e.paymentId,
      onFail: (e) => console.log('Отказ', e.reason),
      onClose: () => console.log('Окно закрыто'),
    });
  };
</script>

<!-- или готовая кнопка -->
<gpay-button payment-id="pay_4bX9qLmT2sR7vKc1Nw8YhPzE"></gpay-button>`}</Code>}
          />

          <H2 id="cards">Как проверить оплату</H2>
          <P>GPAY принимает только деньги игрового банка Bobobank — тестовых карт нет. Чтобы проверить интеграцию, зарегистрируйтесь в Bobobank (виртуальная карта МИР выпускается сразу) и попросите администратора банка начислить деньги на счёт.</P>
          <Params
            rows={[
              ['bank_card', 'карта', 'Карта Bobobank. Покупатель подтверждает покупку в приложении банка; отказы — с понятной причиной (нет денег, карта заморожена, лимит, неверный CVC).'],
              ['sbp', 'QR', 'QR-код на странице оплаты открывает заказ в приложении Bobobank, оплата проходит сразу.'],
              ['bobopay', 'кнопка', 'Bobo Pay: кнопка ведёт в Bobobank, или покупатель вводит номер телефона и подтверждает запрос в приложении.'],
            ]}
          />
          <H2 id="errors">Ошибки</H2>
          <Two
            left={
              <Params
                rows={[
                  ['400 invalid_request', 'error', 'Ошибка в параметрах; поле указано в parameter.'],
                  ['400 invalid_state', 'error', 'Операция недопустима для текущего статуса.'],
                  ['400 insufficient_funds', 'error', 'Недостаточно средств на балансе магазина для выплаты или возврата.'],
                  ['401 invalid_credentials', 'error', 'Неверный или отозванный ключ.'],
                  ['403 forbidden', 'error', 'Магазин заблокирован.'],
                  ['404 not_found', 'error', 'Объект не найден.'],
                  ['429 too_many_requests', 'error', 'Слишком много запросов, повторите позже.'],
                  ['500 internal_server_error', 'error', 'Повторите запрос с тем же Idempotence-Key.'],
                ]}
              />
            }
            right={<Code title="Пример ошибки">{`{\n  "type": "error",\n  "id": "0f3c3a8e-5f5c-4c1d-9e57-0c2b1e6a2d10",\n  "code": "invalid_request",\n  "description": "Сумма позиций чека (1000.00) не совпадает с суммой платежа (1290.00)",\n  "parameter": "receipt.items"\n}`}</Code>}
          />

          <H2 id="sandbox">Песочница</H2>
          <P>Отправьте настоящий запрос к API со своим секретным ключом прямо из браузера. Ключ хранится только в этой вкладке.</P>
          <Sandbox />
        </main>
      </div>
    </div>
  );
}

const PRESETS: { label: string; method: 'GET' | 'POST'; path: string; body?: object }[] = [
  { label: 'Информация о магазине', method: 'GET', path: '/me' },
  { label: 'Создать платёж', method: 'POST', path: '/payments', body: { amount: { value: '1290.00', currency: 'RUB' }, description: 'Заказ из песочницы', confirmation: { type: 'redirect', return_url: `${ORIGIN}/docs` }, metadata: { order_id: 'sandbox-1' } } },
  { label: 'Двухстадийный платёж', method: 'POST', path: '/payments', body: { amount: { value: '5000.00', currency: 'RUB' }, capture: false, description: 'Бронь номера' } },
  { label: 'Список платежей', method: 'GET', path: '/payments?limit=5' },
  { label: 'Получить платёж', method: 'GET', path: '/payments/{id}' },
  { label: 'Подтвердить (capture)', method: 'POST', path: '/payments/{id}/capture', body: {} },
  { label: 'Отменить платёж', method: 'POST', path: '/payments/{id}/cancel', body: {} },
  { label: 'Возврат', method: 'POST', path: '/refunds', body: { payment_id: '{id}', amount: { value: '100.00', currency: 'RUB' } } },
  { label: 'Чеки платежа', method: 'GET', path: '/receipts?payment_id={id}' },
  { label: 'Ссылка на оплату', method: 'POST', path: '/payment_links', body: { title: 'Донат', currency: 'RUB', min_amount: { value: '50.00', currency: 'RUB' } } },
];

function Sandbox() {
  const [key, setKey] = useState(() => {
    try {
      return sessionStorage.getItem('gpay.sandboxKey') ?? '';
    } catch {
      return '';
    }
  });
  const [preset, setPreset] = useState(1);
  const [path, setPath] = useState(PRESETS[1].path);
  const [body, setBody] = useState(JSON.stringify(PRESETS[1].body, null, 2));
  const [idem, setIdem] = useState(() => crypto.randomUUID());
  const [lastId, setLastId] = useState('');
  const [res, setRes] = useState<{ status: number; ms: number; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const p = PRESETS[preset];

  const choose = (i: number) => {
    setPreset(i);
    const sub = (s: string) => s.replace(/\{id\}/g, lastId || '{id}');
    setPath(sub(PRESETS[i].path));
    setBody(PRESETS[i].body ? sub(JSON.stringify(PRESETS[i].body, null, 2)) : '');
    setIdem(crypto.randomUUID());
  };

  const send = async () => {
    setBusy(true);
    try {
      sessionStorage.setItem('gpay.sandboxKey', key);
    } catch {
      /* private mode */
    }
    const t = performance.now();
    try {
      const r = await fetch(`/api/v1${path}`, {
        method: p.method,
        headers: { Authorization: `Bearer ${key.trim()}`, ...(p.method === 'POST' ? { 'Content-Type': 'application/json', 'Idempotence-Key': idem } : {}) },
        body: p.method === 'POST' ? body || '{}' : undefined,
      });
      const text = await r.text();
      let pretty = text;
      try {
        const j = JSON.parse(text);
        pretty = JSON.stringify(j, null, 2);
        if (typeof j.id === 'string' && j.id.startsWith('pay_')) setLastId(j.id);
      } catch {
        /* not json */
      }
      setRes({ status: r.status, ms: Math.round(performance.now() - t), body: pretty });
    } catch (e) {
      setRes({ status: 0, ms: 0, body: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const confirmUrl = (() => {
    try {
      return res ? (JSON.parse(res.body).confirmation?.confirmation_url as string | undefined) : undefined;
    } catch {
      return undefined;
    }
  })();

  return (
    <div className="mt-5 grid grid-cols-1 xl:grid-cols-2 gap-4">
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-card flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-muted">
            Секретный ключ
            <Input type="password" placeholder="sk_live_…" value={key} onChange={(e) => setKey(e.target.value)} mono />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-muted">
            Запрос
            <Select value={preset} onChange={(e) => choose(Number(e.target.value))}>
              {PRESETS.map((x, i) => <option key={i} value={i}>{x.label}</option>)}
            </Select>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <span className={cx('font-mono text-sm font-semibold w-12', p.method === 'GET' ? 'text-info' : 'text-ok')}>{p.method}</span>
          <Input value={path} onChange={(e) => setPath(e.target.value)} mono className="flex-1" aria-label="Путь" />
        </div>
        {p.method === 'POST' && (
          <>
            <div className="flex items-center gap-2 text-xs text-muted">
              Idempotence-Key: <span className="font-mono truncate">{idem}</span>
              <button type="button" className="text-brand" onClick={() => setIdem(crypto.randomUUID())} aria-label="Новый ключ"><RefreshCw className="size-3.5" /></button>
            </div>
            <Textarea mono value={body} onChange={(e) => setBody(e.target.value)} className="min-h-56" aria-label="Тело запроса" />
          </>
        )}
        <Button variant="primary" loading={busy} disabled={!key.trim()} icon={<Play className="size-4" />} onClick={send}>Отправить запрос</Button>
        {!key.trim() && <p className="text-xs text-faint">Ключ можно выпустить в кабинете: «Разработчикам» → «API-ключи».</p>}
      </div>
      <div className="rounded-2xl bg-sunken text-fg  overflow-hidden flex flex-col min-h-72">
        <div className="flex items-center justify-between px-4 h-10 border-b border-line text-xs">
          <span className="text-muted">Ответ</span>
          {res && <span className={cx('font-mono', res.status >= 200 && res.status < 300 ? 'text-ok' : 'text-bad')}>HTTP {res.status} · {res.ms} мс</span>}
        </div>
        <pre className="flex-1 p-4 text-[12px] font-mono overflow-auto max-h-[560px]">{res?.body ?? 'Отправьте запрос, чтобы увидеть ответ'}</pre>
        {confirmUrl && (
          <div className="px-4 py-3 border-t border-line">
            <a href={confirmUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="primary">Открыть страницу оплаты</Button></a>
          </div>
        )}
      </div>
    </div>
  );
}
