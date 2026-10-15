# Бобо.Транспорт

Игровое такси по Москве. Игрок ставит точку на карте, нажимает «Вызвать», видит, как машина-бот едет к нему по настоящим улицам, а затем везёт по маршруту. После поездки деньги списываются со счёта в **Bobobank**.

- **Карта:** плитки OpenStreetMap (© участники OpenStreetMap). Маршруты строит OSRM, адреса ищет Nominatim. Оба сервиса вызываются только с сервера, с кешем, своим User-Agent и не чаще 1 запроса в секунду к Nominatim.
- **Оплата:** «Войти через Bobobank». Банк спрашивает, с какого счёта списывать и какой лимит на одно списание, и выдаёт привязку (мандат).
  - При заказе банк замораживает цену ×1,2.
  - После поездки списывается точная цена, остаток размораживается.
  - Отмена до приезда машины бесплатна. После приезда или через 2 минуты после назначения машины берётся плата за отмену (99 ₽). Чаевые — отдельное списание.
  - Отключить сервис можно в банке: Профиль → Подключённые сервисы.
- **Время ускорено** (по умолчанию ×6): подача длится 15–150 секунд, поездка на 25 минут — около 4 минут. Ускорение настраивается в админке.
- **Тарифы:** Эконом, Комфорт, Комфорт+, Бизнес, Детский. Есть повышенный спрос ×1,0–×1,8 в часы пик, платное ожидание после 3 бесплатных минут, «Остановите здесь» с оплатой за проеханную часть и чек в PDF.

## Установка на VPS

Сначала должны быть установлены портал, GPAY и Bobobank.

```bash
# DNS: A-запись taxi.<домен> → IP сервера
sudo ./deploy/install-transport.sh
```

Скрипт:
1. дописывает в `.env` переменные `TAXI_DOMAIN`, `TRANSPORT_DB_KEY`, `BANK_TRANSPORT_SECRET` и `TRANSPORT_PUBLIC_URL`;
2. включает профиль `transport`;
3. перезапускает банк, чтобы тот узнал секрет такси;
4. настраивает HTTPS: в Caddy добавляет блок, если его нет, а для nginx использует `deploy/nginx-transport.conf.template`.

Администратор назначается после первого входа на сайт:

```bash
docker compose exec transport node dist/cli.js users
docker compose exec transport node dist/cli.js make-admin "Имя из банка"
```

Свой OSRM или Nominatim подключается через переменные `OSRM_URL` и `NOMINATIM_URL` в `.env`.

## Разработка

```bash
npm ci --prefix transport/server && npm ci --prefix transport/web
npm --prefix transport/server test        # тесты сервера (банк, OSRM и Nominatim замоканы)
npm --prefix transport/server run build
# Bobobank на :8082 с TRANSPORT_PUBLIC_URL=http://localhost:8084 BANK_TRANSPORT_SECRET=dev, затем:
cd transport/server && DATA_DIR=./data COOKIE_SECURE=0 BANK_INTERNAL_URL=http://127.0.0.1:8082 \
  BANK_PUBLIC_URL=http://localhost:8082 BANK_TRANSPORT_SECRET=dev node dist/index.js
cd transport/web && npm run dev           # http://localhost:5177, /api проксируется на :8084
```

e2e-тест (Playwright, вместе с банком, OSRM и Nominatim подменены `e2e/fake-osm.mjs`) запускается командой `npx playwright test -c transport/playwright.config.ts`. Как поднять серверы, смотрите в CI-job `transport`.

## API для банка

Такси вызывает `/internal/partner/v1/*` банка с подписью `X-Bank-Signature` (HMAC-SHA256 общим секретом) и заголовком `X-Partner-Client: transport`:

| Метод | Что делает |
|---|---|
| `auth/redeem` | Обменивает одноразовый код на пользователя и привязку |
| `mandates/:id/holds` | Замораживает сумму |
| `holds/:id/capture` | Списывает сумму |
| `holds/:id/void` | Снимает холд |
| `mandates/:id/charges` | Списывает сразу (чаевые) |
| `charges/:id/refund` | Делает возврат |
