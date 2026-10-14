# GPAY — инструкция по подключению для ИИ-агентов

> Этот документ написан для ИИ-агентов (Claude, ChatGPT, Cursor, Copilot и др.), которым поручили подключить приём оплаты GPAY к проекту. Он самодостаточен: прочитав его целиком, агент может сделать интеграцию без других источников. Человекочитаемая версия с песочницей: {{BASE}}/docs

GPAY (GnusaPay) — платёжный сервис: страница оплаты (карты МИР/Visa/Mastercard/UnionPay, СБП, оплата частями, криптовалюта), онлайн-касса с чеками по 54-ФЗ, ссылки на оплату, возвраты, выплаты, вебхуки. Реальные деньги не списываются: карты выпускает банк-эмитент GPAY Bank, исход операции определяется номером карты (см. «Карты»).

## Ключевые факты (кратко)

- Базовый URL API: `{{BASE}}/api/v1`
- Формат: JSON, UTF-8. Суммы — строки с двумя знаками после точки: `"1290.00"`.
- Валюты: `RUB`, `USD`, `EUR`.
- Авторизация: заголовок `Authorization: Bearer <секретный ключ sk_live_…>` (или Basic `<shop_id>:<секретный ключ>`).
- Каждый POST требует заголовок `Idempotence-Key` (уникальная строка ≤ 64 символов, например UUID v4).
- Основной сценарий: сервер создаёт платёж → перенаправляет покупателя на `confirmation.confirmation_url` → получает вебхук `payment.succeeded` → выдаёт товар.
- Статусы платежа: `pending` → (`waiting_for_capture`) → `succeeded` | `canceled`.
- Вебхуки подписаны: `GPAY-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<сырое тело>")>`.
- Секретный ключ используется ТОЛЬКО на сервере. Никогда не помещай его в браузерный код, мобильное приложение или репозиторий.

## Что агенту нужно получить от человека

Перед началом спроси у пользователя (или найди в переменных окружения проекта):

1. `GPAY_SECRET_KEY` — секретный ключ `sk_live_…`. Выпускается в кабинете: {{BASE}}/app → раздел «Разработчикам» → «API-ключи» → «Выпустить ключ». Ключ показывается один раз.
2. `GPAY_WEBHOOK_SECRET` — секрет эндпоинта вебхуков `whsec_…`. Создаётся там же, во вкладке «Вебхуки», после добавления URL вашего сервера (например `https://example.com/api/gpay/webhook`).
3. Публичный URL проекта для `return_url` (куда вернуть покупателя после оплаты).

Если ключа нет, попроси пользователя зарегистрироваться на {{BASE}}/register, создать магазин и выпустить ключ. Не придумывай ключи.

Храни ключи в переменных окружения (`.env`, секреты CI/хостинга). Добавь `.env` в `.gitignore`.

## Пошаговая интеграция

### Шаг 1. Создать платёж (на сервере)

`POST {{BASE}}/api/v1/payments`

```http
POST /api/v1/payments HTTP/1.1
Host: {{HOST}}
Authorization: Bearer $GPAY_SECRET_KEY
Idempotence-Key: 6f1c3e3a-2c7b-4c55-9a2e-1f0b9f3d7a10
Content-Type: application/json

{
  "amount": { "value": "1290.00", "currency": "RUB" },
  "description": "Заказ №4821",
  "capture": true,
  "confirmation": { "type": "redirect", "return_url": "https://example.com/orders/4821" },
  "metadata": { "order_id": "4821" },
  "receipt": {
    "customer": { "email": "buyer@example.com" },
    "items": [
      { "description": "Капучино 0,4 л", "quantity": 2, "amount": { "value": "320.00", "currency": "RUB" }, "vat_code": "vat22", "payment_subject": "commodity", "payment_mode": "full_payment" },
      { "description": "Круассан", "quantity": 1, "amount": { "value": "650.00", "currency": "RUB" }, "vat_code": "vat10" }
    ]
  }
}
```

Поля запроса:

| Поле | Тип | Обязательно | Описание |
|---|---|---|---|
| `amount.value` | string | да | Сумма, `"1290.00"`. Минимум 1.00 RUB / 0.50 USD/EUR. |
| `amount.currency` | string | да | `RUB`, `USD` или `EUR`. |
| `description` | string | нет | До 128 символов, видно покупателю. |
| `capture` | boolean | нет | `true` (по умолчанию) — списать сразу; `false` — двухстадийный платёж (заморозка). |
| `confirmation.type` | string | нет | `redirect`. |
| `confirmation.return_url` | string | нет | http(s)-адрес возврата покупателя. |
| `metadata` | object | нет | До 16 пар «строка → строка» (ключ ≤ 32, значение ≤ 512). Возвращается в ответах и вебхуках — храни тут ID заказа. |
| `receipt` | object | нет | Данные чека. Если передан, сумма `items` (`amount.value × quantity`) ДОЛЖНА точно равняться `amount.value`, иначе ошибка 400. |
| `receipt.customer.email` | string | нет | Куда отправить чек. |
| `receipt.items[].vat_code` | string | нет | {{VAT}}. По умолчанию `vat22`. |
| `receipt.items[].payment_subject` | string | нет | {{SUBJECTS}}. |
| `receipt.items[].payment_mode` | string | нет | {{MODES}}. |

Ответ `200 OK`:

```json
{
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
    "confirmation_url": "{{BASE}}/pay/pay_4bX9qLmT2sR7vKc1Nw8YhPzE",
    "return_url": "https://example.com/orders/4821"
  },
  "test": false,
  "refundable": false,
  "receipt_registration": "pending",
  "metadata": { "order_id": "4821" }
}
```

Сохрани `id` платежа рядом с заказом в своей базе.

### Шаг 2. Отправить покупателя на оплату

Вариант А (проще всего): HTTP-редирект 302 на `confirmation.confirmation_url`.

Вариант Б: всплывающее окно поверх сайта (виджет):

```html
<script src="{{BASE}}/gpay.js" async></script>
<script>
  // paymentId получен с вашего сервера после шага 1
  GPAY.checkout({
    paymentId: 'pay_…',
    onSuccess: (e) => { location.href = '/orders/4821'; }, // окончательно проверяйте статус на сервере!
    onFail: (e) => console.log('Отказ', e.reason),          // вызывается на каждую неудачную попытку
    onClose: () => console.log('Окно закрыто'),
  });
</script>
```

Или готовая кнопка без JavaScript-кода: `<gpay-button payment-id="pay_…">Оплатить</gpay-button>` (события `gpay:success`, `gpay:fail`, `gpay:close` всплывают на элементе).

Вариант В: ссылка на оплату без кода (см. «Ссылки на оплату»).

### Шаг 3. Получить результат (вебхук)

Источник истины — вебхук или запрос `GET /api/v1/payments/{id}`. Возврат покупателя на `return_url` НЕ означает, что оплата прошла.

Вебхук — `POST` на ваш URL с телом:

```json
{
  "type": "notification",
  "id": "evt_Qm3x9ZpL0aT5yB7cD1eF",
  "event": "payment.succeeded",
  "created_at": "2026-10-13T09:01:12.000Z",
  "object": { "id": "pay_…", "status": "succeeded", "paid": true, "amount": { "value": "1290.00", "currency": "RUB" }, "income_amount": { "value": "1253.88", "currency": "RUB" }, "metadata": { "order_id": "4821" } }
}
```

События: {{EVENTS}}.

Заголовки: `GPAY-Signature: t=<unix seconds>,v1=<hex>`, `GPAY-Event-Id: evt_…`, `Content-Type: application/json`.

Проверка подписи (обязательно):

1. Возьми СЫРОЕ тело запроса (байты, до JSON-парсинга).
2. `expected = HMAC_SHA256(key = GPAY_WEBHOOK_SECRET, message = t + "." + rawBody)` в hex.
3. Сравни с `v1` константным по времени сравнением; отклони, если `|now − t| > 300` секунд.
4. Ответь `2xx` в течение 10 секунд. Иначе GPAY повторит отправку через 1 мин, 5 мин, 30 мин, 2 ч, 5 ч и 16 ч.
5. Обработчик должен быть идемпотентным: одно и то же событие может прийти повторно — проверяй `GPAY-Event-Id` или текущий статус заказа.

Node.js (Express):

```js
import crypto from 'node:crypto';
import express from 'express';

const app = express();
app.post('/api/gpay/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const parts = Object.fromEntries(String(req.get('GPAY-Signature') ?? '').split(',').map((p) => p.split('=')));
  const expected = crypto.createHmac('sha256', process.env.GPAY_WEBHOOK_SECRET).update(`${parts.t}.${req.body}`).digest('hex');
  const ok = parts.v1 && parts.v1.length === expected.length && crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
  if (!ok || Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return res.sendStatus(400);
  const { event, object } = JSON.parse(req.body);
  if (event === 'payment.succeeded') markOrderPaid(object.metadata.order_id, object.id); // идемпотентно
  if (event === 'payment.canceled') markOrderFailed(object.metadata.order_id);
  res.sendStatus(200);
});
```

Python (Flask):

```python
import hmac, hashlib, os, time
from flask import Flask, request, abort

app = Flask(__name__)

@app.post("/api/gpay/webhook")
def gpay_webhook():
    parts = dict(p.split("=", 1) for p in request.headers.get("GPAY-Signature", "").split(",") if "=" in p)
    raw = request.get_data()
    expected = hmac.new(os.environ["GPAY_WEBHOOK_SECRET"].encode(), f"{parts.get('t')}.".encode() + raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, parts.get("v1", "")) or abs(time.time() - int(parts.get("t", 0))) > 300:
        abort(400)
    event = request.get_json()
    if event["event"] == "payment.succeeded":
        mark_order_paid(event["object"]["metadata"]["order_id"], event["object"]["id"])
    return "", 200
```

PHP:

```php
<?php
$raw = file_get_contents('php://input');
parse_str(str_replace(',', '&', $_SERVER['HTTP_GPAY_SIGNATURE'] ?? ''), $sig);
$expected = hash_hmac('sha256', ($sig['t'] ?? '') . '.' . $raw, getenv('GPAY_WEBHOOK_SECRET'));
if (!hash_equals($expected, $sig['v1'] ?? '') || abs(time() - (int)($sig['t'] ?? 0)) > 300) { http_response_code(400); exit; }
$event = json_decode($raw, true);
if ($event['event'] === 'payment.succeeded') { markOrderPaid($event['object']['metadata']['order_id'], $event['object']['id']); }
http_response_code(200);
```

Если вебхуки недоступны (локальная разработка без публичного URL) — опрашивай `GET /api/v1/payments/{id}` раз в 2–5 секунд, пока статус не станет `succeeded` или `canceled`. Вебхуки на `localhost` и внутренние сети GPAY не отправляет.

## Справочник API

Все пути относительно `{{BASE}}/api/v1`. Все POST — с `Idempotence-Key`.

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/me` | Информация о магазине, включённые способы оплаты, балансы. Удобно для проверки ключа. |
| POST | `/payments` | Создать платёж. |
| GET | `/payments/{id}` | Получить платёж. |
| GET | `/payments?status=&limit=&cursor=` | Список (новые сначала), `limit` 1–100, следующая страница — `next_cursor`. |
| POST | `/payments/{id}/capture` | Списать замороженный платёж (`waiting_for_capture`). Тело `{ "amount": {…} }` — необязательно, для частичного списания. |
| POST | `/payments/{id}/cancel` | Отменить `pending` или `waiting_for_capture`. Тело `{}`. |
| POST | `/refunds` | Возврат: `{ "payment_id": "pay_…", "amount": { "value": "100.00", "currency": "RUB" }, "description": "…" }`. Без `amount` — полный возврат остатка. |
| GET | `/refunds?payment_id=` · `/refunds/{id}` | Возвраты. |
| GET | `/receipts?payment_id=` · `/receipts/{id}` | Фискальные чеки (приход и возврат прихода), поле `url` — ссылка на чек для покупателя. |
| POST | `/payment_links` | Ссылка на оплату (см. ниже). |
| GET | `/payment_links` · `/payment_links/{id}` | Ссылки. |
| POST | `/payouts` | Вывод баланса: `{ "amount": {…}, "payout_destination": { "card_last4": "4242" } }`. |
| GET | `/payouts` | Выплаты. |

### Объект платежа (основные поля)

- `id` — `pay_…`.
- `status` — `pending` | `waiting_for_capture` | `succeeded` | `canceled`.
- `paid` — деньги получены/заморожены.
- `amount`, `income_amount` (сумма за вычетом комиссии GPAY), `refunded_amount`.
- `payment_method` — `{ type: "bank_card" | "sbp" | "installments" | "crypto", title, card?: { first6, last4, card_type, expiry_month, expiry_year } }`.
- `confirmation.confirmation_url` — только в `pending`.
- `expires_at` — до какого момента можно оплатить (`pending`, 1 час) или подтвердить (`waiting_for_capture`, 7 дней).
- `cancellation_details` — `{ party, reason }` у отменённых.
- `authorization_details` — `{ rrn, auth_code, three_d_secure: { applied } }`.
- `metadata`, `refundable`, `receipt_registration`.

### Статусы и переходы

| Статус | Значение | Что делать |
|---|---|---|
| `pending` | Ожидает оплаты. Покупатель может сделать до 5 попыток. | Ждать. Через 1 час без оплаты → `canceled` (`expired_on_confirmation`). |
| `waiting_for_capture` | Только при `capture: false`. Деньги заморожены. | Вызвать `/capture` или `/cancel` в течение 7 дней, иначе автоотмена (`expired_on_capture`). |
| `succeeded` | Оплачен, чек зарегистрирован. | Выдать товар. Возможен возврат. |
| `canceled` | Отменён. | Причина в `cancellation_details.reason`. Создать новый платёж, если покупатель хочет повторить. |

Причины отмены: `expired_on_confirmation`, `too_many_attempts`, `expired_on_capture`, `canceled_by_merchant`.
Причины отказа отдельной попытки (видны покупателю, платёж остаётся `pending`): `insufficient_funds`, `card_expired`, `issuer_unavailable`, `general_decline`, `invalid_csc`, `card_blocked`, `limit_exceeded`.

### Ссылки на оплату

`POST /api/v1/payment_links` — когда у проекта нет своего бэкенда (бот, соцсети, офлайн-точка):

```json
{ "title": "Абонемент на месяц", "amount": { "value": "3500.00", "currency": "RUB" }, "reusable": true }
```

- Свободная сумма: вместо `amount` передай `"currency": "RUB"` и при желании `min_amount` / `max_amount`.
- Счёт с позициями: `"type": "invoice"`, `amount` и `receipt.items` (сумма позиций = `amount`), `customer: { email, name }`. Счёт оплачивается один раз.
- `expires_at` — ISO 8601, срок действия.
- В ответе `url` — ссылка для покупателя. Оплаты по ссылке создают обычные платежи и вебхуки; `metadata` у них нет, связывай по описанию/сумме или используй API-платежи.

### Ошибки

Формат: `{ "type": "error", "id": "…", "code": "…", "description": "…", "parameter": "…" }`.

| HTTP | `code` | Что делать |
|---|---|---|
| 400 | `invalid_request` | Исправь параметр из `parameter`. Частые: сумма не строкой, нет `Idempotence-Key`, сумма позиций чека ≠ сумме платежа. |
| 400 | `invalid_state` | Операция недопустима в текущем статусе (например, возврат неоплаченного). |
| 400 | `insufficient_funds` | Недостаточно средств на балансе магазина для выплаты или возврата. Возврат оплачивается с баланса магазина. |
| 401 | `invalid_credentials` | Неверный/отозванный ключ. Попроси пользователя выпустить новый. |
| 403 | `forbidden` | Магазин заблокирован. |
| 404 | `not_found` | Объект не найден или принадлежит другому магазину. |
| 429 | `too_many_requests` | Подожди и повтори. |
| 500 | `internal_server_error` | Повтори с ТЕМ ЖЕ `Idempotence-Key`. |

Идемпотентность: повтор с тем же ключом в течение 24 часов возвращает сохранённый ответ, дубль не создаётся. Тот же ключ с другим телом → 400. Генерируй новый ключ на каждую новую операцию, но переиспользуй его при сетевых повторах.

## Карты и сценарии (для проверки интеграции)

Срок действия — любая будущая дата, CVC — любые три цифры. Карты других банков не принимаются (форма отклоняет их до отправки).

{{CARDS}}

- Карты «Успех после проверки банком (3-D Secure)»: покупатель видит экран «Связываемся с банком», через 3–5 секунд платёж проходит автоматически.
- СБП, оплата частями и криптовалюта подтверждаются автоматически через 9–14 секунд после начала оплаты.

## Карты Bobobank и «боевые» деньги

Если GPAY подключён к игровому банку Bobobank, покупатели платят реальным игровым балансом:

- **Карта Bobobank** (МИР, Visa, Mastercard, UnionPay, выпущенная в Bobobank) — банк проверяет баланс, лимиты и блокировки. Обычно покупатель подтверждает покупку в приложении банка: платёж остаётся `pending`, страница оплаты показывает «Подтвердите покупку в приложении Bobobank», после подтверждения — `succeeded` (или `waiting_for_capture` при `capture: false`).
- **СБП из приложения Bobobank** — QR-код на странице оплаты открывает заказ в банке; после подтверждения платёж сразу `succeeded`.
- В объекте платежа `test: false` означает оплату деньгами Bobobank, `test: true` — тестовой картой или имитацией (СБП «другой банк», частями, крипта).
- Баланс магазина делится на деньги Bobobank (`live`) и тестовые (`test`). Деньги Bobobank выводятся только на счёт в Bobobank: `POST /payouts` с `"payout_destination": {"type": "bobobank"}` (счёт подключается кодом из приложения банка в настройках магазина). Тестовые — на карту: `{"type": "bank_card", "card_last4": "1234"}`.
- Возврат по платежу Bobobank возвращает деньги на ту же карту или счёт покупателя.

Агенту ничего дополнительно делать не нужно: интеграция одинакова, выдавай товар только по `payment.succeeded`.

## Комиссии

{{FEES}}

Комиссия удерживается при зачислении (`income_amount = amount − комиссия`). Возвраты комиссию не возвращают.

## Готовые фрагменты кода

Node.js (fetch, Node 18+):

```js
const GPAY = '{{BASE}}/api/v1';

export async function createPayment(order) {
  const res = await fetch(`${GPAY}/payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GPAY_SECRET_KEY}`,
      'Idempotence-Key': `order-${order.id}-${order.attempt ?? 1}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: { value: (order.totalKopecks / 100).toFixed(2), currency: 'RUB' },
      description: `Заказ №${order.id}`,
      confirmation: { type: 'redirect', return_url: `${process.env.PUBLIC_URL}/orders/${order.id}` },
      metadata: { order_id: String(order.id) },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`GPAY ${data.code}: ${data.description}`);
  return data; // data.id, data.confirmation.confirmation_url
}

export async function getPayment(id) {
  const res = await fetch(`${GPAY}/payments/${id}`, { headers: { Authorization: `Bearer ${process.env.GPAY_SECRET_KEY}` } });
  return res.json();
}
```

Python (requests):

```python
import os, uuid, requests

GPAY = "{{BASE}}/api/v1"
HEADERS = {"Authorization": f"Bearer {os.environ['GPAY_SECRET_KEY']}"}

def create_payment(order_id: str, amount_rub: str, return_url: str) -> dict:
    r = requests.post(f"{GPAY}/payments", headers={**HEADERS, "Idempotence-Key": f"order-{order_id}"}, json={
        "amount": {"value": amount_rub, "currency": "RUB"},
        "description": f"Заказ №{order_id}",
        "confirmation": {"type": "redirect", "return_url": return_url},
        "metadata": {"order_id": order_id},
    }, timeout=15)
    data = r.json()
    if not r.ok:
        raise RuntimeError(f"GPAY {data['code']}: {data['description']}")
    return data  # data["confirmation"]["confirmation_url"]
```

cURL (проверка ключа):

```bash
curl {{BASE}}/api/v1/me -H "Authorization: Bearer $GPAY_SECRET_KEY"
```

## Чек-лист агента

1. [ ] Ключ `GPAY_SECRET_KEY` берётся из переменных окружения и используется только на сервере.
2. [ ] `GET /me` с ключом возвращает 200 — ключ рабочий.
3. [ ] Создание платежа: сумма строкой с двумя знаками, `Idempotence-Key` на каждый POST, `metadata.order_id` для связи с заказом.
4. [ ] Покупатель перенаправляется на `confirmation_url` (или открывается виджет).
5. [ ] Есть обработчик вебхуков с проверкой подписи по сырому телу и ответом 2xx; обработка идемпотентна.
6. [ ] Заказ помечается оплаченным только по `payment.succeeded` (или по `GET /payments/{id}` со статусом `succeeded`), а не по возврату на `return_url`.
7. [ ] Обработан `payment.canceled` (показать покупателю «оплата не прошла», предложить повторить).
8. [ ] Если в чеке есть позиции — их сумма равна сумме платежа.
9. [ ] Проверено картой `4111 1111 1111 1111` (успех), `4000 0000 0000 9995` (отказ), `4000 0000 0000 3220` (проверка банком 3–5 с).
10. [ ] Секреты не попали в git, логи и клиентский код.

## Частые ошибки агентов

- Передают сумму числом (`1290`) вместо строки (`"1290.00"`).
- Забывают `Idempotence-Key` → 400.
- Считают платёж оплаченным при возврате на `return_url`.
- Проверяют подпись вебхука по распарсенному и заново сериализованному JSON — подпись не совпадёт. Нужно сырое тело.
- Вызывают API из браузера с секретным ключом. Так делать нельзя — только с сервера.
- Ставят в чек позиции, сумма которых не равна сумме платежа.

## Ссылки

- Документация для людей с песочницей: {{BASE}}/docs
- Кабинет (ключи, вебхуки, журнал запросов и доставок): {{BASE}}/app
- Регистрация: {{BASE}}/register
- Виджет: {{BASE}}/gpay.js
- Этот файл: {{BASE}}/llms-full.txt · краткий индекс: {{BASE}}/llms.txt
