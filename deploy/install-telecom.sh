#!/usr/bin/env bash
# Бобтелеком — игровой оператор связи на том же VPS, где уже работает Bobobank.
#
#   sudo ./deploy/install-telecom.sh                          # адрес telecom.<домен портала>
#   sudo TELECOM_DOMAIN=telecom.example.com ./deploy/install-telecom.sh
#
# Заранее создайте DNS-запись A для TELECOM_DOMAIN на IP сервера.
# Bobobank должен быть установлен раньше (deploy/install-bobobank.sh): абонплата списывается со счетов банка.
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
TELECOM_DOMAIN="${TELECOM_DOMAIN:-telecom.${DOMAIN:?В .env нет DOMAIN}}"
TELECOM_PORT="${TELECOM_PORT:-8085}"
while [[ -z "$(grep '^TELECOM_PORT=' .env || true)" ]] && ss -ltnH "( sport = :$TELECOM_PORT )" | grep -q .; do TELECOM_PORT=$((TELECOM_PORT + 1)); done
umask 077
setenv TELECOM_DOMAIN "$TELECOM_DOMAIN"
setenv TELECOM_PORT "$TELECOM_PORT"
setenv TELECOM_DB_KEY "$(openssl rand -hex 32)"
setenv BANK_TELECOM_SECRET "$(openssl rand -hex 32)"
setenv TELECOM_PUBLIC_URL "https://$TELECOM_DOMAIN"
add_profile telecom
set -a; . ./.env; set +a
info "Адрес Бобтелекома: https://$TELECOM_DOMAIN"
warn "В .env добавлены TELECOM_DB_KEY и BANK_TELECOM_SECRET — сохраните копию .env."
mkdir -p telecom-data && chown 1000:1000 telecom-data && chmod 700 telecom-data

bold "2/4  Запуск (Бобтелеком и банк с подключённым оператором)"
docker compose up -d --build
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$TELECOM_PORT/api/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "http://127.0.0.1:$TELECOM_PORT/api/health" >/dev/null || die "Бобтелеком не отвечает. Логи: docker compose logs telecom"
info "Бобтелеком запущен на 127.0.0.1:$TELECOM_PORT."

bold "3/4  HTTPS"
if [[ ",$COMPOSE_PROFILES," == *",caddy,"* ]]; then
  if ! grep -q 'TELECOM_DOMAIN' deploy/Caddyfile; then
    printf '\n# Бобтелеком (profile "telecom").\n{$TELECOM_DOMAIN:telecom.localhost} {\n\tencode zstd gzip\n\treverse_proxy telecom:8085\n}\n' >>deploy/Caddyfile
    info "В deploy/Caddyfile добавлен блок для Бобтелекома."
  fi
  docker compose up -d caddy >/dev/null
  docker compose restart caddy >/dev/null
  info "Caddy выпустит сертификат для $TELECOM_DOMAIN автоматически."
elif command -v nginx >/dev/null 2>&1; then
  CONF=/etc/nginx/sites-available/telecom.conf
  info "Будет создан $CONF (server_name $TELECOM_DOMAIN → 127.0.0.1:$TELECOM_PORT) и выпущен сертификат certbot."
  if ask "Применить изменения nginx?"; then
    sed -e "s/__DOMAIN__/$TELECOM_DOMAIN/" -e "s/__APP_PORT__/$TELECOM_PORT/" deploy/nginx-telecom.conf.template >"$CONF"
    ln -sf "$CONF" /etc/nginx/sites-enabled/telecom.conf
    nginx -t && systemctl reload nginx
    command -v certbot >/dev/null 2>&1 || apt-get install -y certbot python3-certbot-nginx
    if [[ -n "${ACME_EMAIL:-}" ]]; then EMAIL_ARGS=(--email "$ACME_EMAIL"); else EMAIL_ARGS=(--register-unsafely-without-email); fi
    certbot --nginx -d "$TELECOM_DOMAIN" --non-interactive --agree-tos --redirect "${EMAIL_ARGS[@]}"
  else
    warn "nginx не изменён. Проксируйте $TELECOM_DOMAIN на 127.0.0.1:$TELECOM_PORT вручную (пример: deploy/nginx-telecom.conf.template)."
  fi
else
  warn "Настройте прокси $TELECOM_DOMAIN → 127.0.0.1:$TELECOM_PORT с HTTPS вручную."
fi

bold "4/4  Проверка связи с банком"
if docker compose exec -T bobobank printenv BANK_TELECOM_SECRET 2>/dev/null | grep -q .; then
  info "Bobobank знает секрет Бобтелекома — «Войти через Bobobank» работает."
else
  warn "Bobobank запущен без BANK_TELECOM_SECRET. Выполните: docker compose up -d bobobank"
fi

echo
if grep -q '^GOS_PUBLIC_URL=' .env; then
  info "Бобуслуги найдены: в кабинете появится номер, если выполнить в Supabase SQL Editor"
  info "  bobuslugi/supabase/migrations/20261017000001_telecom.sql"
  docker compose up -d --build bobuslugi >/dev/null 2>&1 || true
fi

echo
bold "Готово!  Откройте https://$TELECOM_DOMAIN и нажмите «Войти через Bobobank»."
info "Админка Бобтелекома: войдите на сайт, затем выполните"
info "  docker compose exec telecom node dist/cli.js make-admin \"Ваше имя\""
info "Обновление вместе с порталом:  ./deploy/update.sh"
