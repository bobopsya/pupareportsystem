#!/usr/bin/env bash
# Бобо.Транспорт — игровое такси по Москве на том же VPS, где уже работает Bobobank.
#
#   sudo ./deploy/install-transport.sh                          # адрес taxi.<домен портала>
#   sudo TAXI_DOMAIN=taxi.example.com ./deploy/install-transport.sh
#
# Заранее создайте DNS-запись A для TAXI_DOMAIN на IP сервера.
# Bobobank должен быть установлен раньше (deploy/install-bobobank.sh): такси списывает деньги со счетов банка.
set -euo pipefail

cd "$(dirname "$0")/.."

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ask() {
  local answer
  read -r -p "$1 [y/N] " answer </dev/tty || true
  [[ "$answer" =~ ^[YyДд] ]]
}
setenv() { # setenv KEY VALUE — добавляет ключ в .env, если его ещё нет
  grep -q "^$1=" .env || echo "$1=$2" >>.env
}
add_profile() {
  local cur new
  cur="$(grep '^COMPOSE_PROFILES=' .env | cut -d= -f2- || true)"
  [[ ",$cur," == *",$1,"* ]] && return
  new="${cur:+$cur,}$1"
  if grep -q '^COMPOSE_PROFILES=' .env; then sed -i "s/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=$new/" .env; else echo "COMPOSE_PROFILES=$new" >>.env; fi
}

[[ $EUID -eq 0 ]] || die "Запустите от root"
[[ -f .env ]] || die "Нет .env — сначала установите портал: ./deploy/install.sh"
set -a; . ./.env; set +a
grep -q '^BANK_DOMAIN=' .env || die "Bobobank не установлен — сначала ./deploy/install-bobobank.sh"

bold "1/4  Настройки (.env)"
TAXI_DOMAIN="${TAXI_DOMAIN:-taxi.${DOMAIN:?В .env нет DOMAIN}}"
TAXI_PORT="${TAXI_PORT:-8084}"
while [[ -z "$(grep '^TAXI_PORT=' .env || true)" ]] && ss -ltnH "( sport = :$TAXI_PORT )" | grep -q .; do TAXI_PORT=$((TAXI_PORT + 1)); done
umask 077
setenv TAXI_DOMAIN "$TAXI_DOMAIN"
setenv TAXI_PORT "$TAXI_PORT"
setenv TRANSPORT_DB_KEY "$(openssl rand -hex 32)"
setenv BANK_TRANSPORT_SECRET "$(openssl rand -hex 32)"
setenv TRANSPORT_PUBLIC_URL "https://$TAXI_DOMAIN"
add_profile transport
set -a; . ./.env; set +a
info "Адрес такси: https://$TAXI_DOMAIN"
warn "В .env добавлены TRANSPORT_DB_KEY и BANK_TRANSPORT_SECRET — сохраните копию .env."
mkdir -p transport-data && chown 1000:1000 transport-data && chmod 700 transport-data

bold "2/4  Запуск (такси и банк с подключённым такси)"
docker compose up -d --build
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$TAXI_PORT/api/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "http://127.0.0.1:$TAXI_PORT/api/health" >/dev/null || die "Бобо.Транспорт не отвечает. Логи: docker compose logs transport"
info "Бобо.Транспорт запущен на 127.0.0.1:$TAXI_PORT."

bold "3/4  HTTPS"
if [[ ",$COMPOSE_PROFILES," == *",caddy,"* ]]; then
  if ! grep -q 'TAXI_DOMAIN' deploy/Caddyfile; then
    printf '\n# Бобо.Транспорт (profile "transport").\n{$TAXI_DOMAIN:taxi.localhost} {\n\tencode zstd gzip\n\treverse_proxy transport:8084\n}\n' >>deploy/Caddyfile
    info "В deploy/Caddyfile добавлен блок для такси."
  fi
  docker compose up -d caddy >/dev/null
  docker compose restart caddy >/dev/null
  info "Caddy выпустит сертификат для $TAXI_DOMAIN автоматически."
elif command -v nginx >/dev/null 2>&1; then
  CONF=/etc/nginx/sites-available/transport.conf
  info "Будет создан $CONF (server_name $TAXI_DOMAIN → 127.0.0.1:$TAXI_PORT) и выпущен сертификат certbot."
  if ask "Применить изменения nginx?"; then
    sed -e "s/__DOMAIN__/$TAXI_DOMAIN/" -e "s/__APP_PORT__/$TAXI_PORT/" deploy/nginx-transport.conf.template >"$CONF"
    ln -sf "$CONF" /etc/nginx/sites-enabled/transport.conf
    nginx -t && systemctl reload nginx
    command -v certbot >/dev/null 2>&1 || apt-get install -y certbot python3-certbot-nginx
    if [[ -n "${ACME_EMAIL:-}" ]]; then EMAIL_ARGS=(--email "$ACME_EMAIL"); else EMAIL_ARGS=(--register-unsafely-without-email); fi
    certbot --nginx -d "$TAXI_DOMAIN" --non-interactive --agree-tos --redirect "${EMAIL_ARGS[@]}"
  else
    warn "nginx не изменён. Проксируйте $TAXI_DOMAIN на 127.0.0.1:$TAXI_PORT вручную (пример: deploy/nginx-transport.conf.template)."
  fi
else
  warn "Настройте прокси $TAXI_DOMAIN → 127.0.0.1:$TAXI_PORT с HTTPS вручную."
fi

bold "4/4  Проверка связи с банком"
if docker compose exec -T bobobank printenv BANK_TRANSPORT_SECRET 2>/dev/null | grep -q .; then
  info "Bobobank знает секрет такси — «Войти через Bobobank» работает."
else
  warn "Bobobank запущен без BANK_TRANSPORT_SECRET. Выполните: docker compose up -d bobobank"
fi

echo
bold "Готово!  Откройте https://$TAXI_DOMAIN и нажмите «Войти через Bobobank»."
info "Админка такси: войдите на сайт, затем выполните"
info "  docker compose exec transport node dist/cli.js make-admin \"Ваше имя\""
info "Обновление вместе с порталом:  ./deploy/update.sh"
