#!/usr/bin/env bash
# GPAY — подключение платёжной системы на том же VPS, где уже установлен портал.
#
#   sudo ./deploy/install-gpay.sh                          # адрес pay.<домен портала>
#   sudo GPAY_DOMAIN=pay.example.com ./deploy/install-gpay.sh
#
# Для своего домена заранее создайте DNS-запись A для GPAY_DOMAIN на IP сервера.
# Для адресов *.sslip.io ничего настраивать не нужно.
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

[[ $EUID -eq 0 ]] || die "Запустите от root: sudo $0"
[[ -f .env ]] || die "Нет .env — сначала установите портал: sudo ./deploy/install.sh"
set -a; . ./.env; set +a

bold "1/4  Настройки (.env)"
GPAY_DOMAIN="${GPAY_DOMAIN:-pay.${DOMAIN:?В .env нет DOMAIN}}"
GPAY_PORT="${GPAY_PORT:-8081}"
while [[ -z "$(grep '^GPAY_PORT=' .env || true)" ]] && ss -ltnH "( sport = :$GPAY_PORT )" | grep -q .; do GPAY_PORT=$((GPAY_PORT + 1)); done
umask 077
setenv GPAY_DOMAIN "$GPAY_DOMAIN"
setenv GPAY_PORT "$GPAY_PORT"
setenv GPAY_DB_KEY "$(openssl rand -hex 32)"
CUR_PROFILES="$(grep '^COMPOSE_PROFILES=' .env | cut -d= -f2- || true)"
if [[ ",$CUR_PROFILES," != *",gpay,"* ]]; then
  NEW_PROFILES="${CUR_PROFILES:+$CUR_PROFILES,}gpay"
  if grep -q '^COMPOSE_PROFILES=' .env; then sed -i "s/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=$NEW_PROFILES/" .env; else echo "COMPOSE_PROFILES=$NEW_PROFILES" >>.env; fi
fi
set -a; . ./.env; set +a
info "Адрес GPAY: https://$GPAY_DOMAIN"
warn "В .env добавлен ключ GPAY_DB_KEY — сохраните копию .env: без ключа база GPAY не расшифруется."
mkdir -p gpay-data && chown 1000:1000 gpay-data && chmod 700 gpay-data

bold "2/4  Запуск"
docker compose up -d --build
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$GPAY_PORT/api/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "http://127.0.0.1:$GPAY_PORT/api/health" >/dev/null || die "GPAY не отвечает. Логи: docker compose logs gpay"
info "GPAY запущен на 127.0.0.1:$GPAY_PORT."

bold "3/4  HTTPS"
if [[ ",$COMPOSE_PROFILES," == *",caddy,"* ]]; then
  docker compose restart caddy >/dev/null
  info "Caddy выпустит сертификат для $GPAY_DOMAIN автоматически."
elif command -v nginx >/dev/null 2>&1; then
  CONF=/etc/nginx/sites-available/gpay.conf
  info "Будет создан $CONF (server_name $GPAY_DOMAIN → 127.0.0.1:$GPAY_PORT) и выпущен сертификат certbot."
  if ask "Применить изменения nginx?"; then
    sed -e "s/__DOMAIN__/$GPAY_DOMAIN/" -e "s/__APP_PORT__/$GPAY_PORT/" deploy/nginx-gpay.conf.template >"$CONF"
    ln -sf "$CONF" /etc/nginx/sites-enabled/gpay.conf
    nginx -t && systemctl reload nginx
    command -v certbot >/dev/null 2>&1 || apt-get install -y certbot python3-certbot-nginx
    if [[ -n "${ACME_EMAIL:-}" ]]; then EMAIL_ARGS=(--email "$ACME_EMAIL"); else EMAIL_ARGS=(--register-unsafely-without-email); fi
    certbot --nginx -d "$GPAY_DOMAIN" --non-interactive --agree-tos --redirect "${EMAIL_ARGS[@]}"
  else
    warn "nginx не изменён. Проксируйте $GPAY_DOMAIN на 127.0.0.1:$GPAY_PORT вручную (пример: deploy/nginx-gpay.conf.template)."
  fi
else
  warn "Настройте прокси $GPAY_DOMAIN → 127.0.0.1:$GPAY_PORT с HTTPS вручную."
fi

bold "4/4  Администратор GPAY"
if docker compose exec -T gpay node dist/cli.js has-admins >/dev/null 2>&1; then
  info "Администратор уже есть — пропускаю."
else
  read -r -p "  Email администратора: " ADMIN_EMAIL </dev/tty || true
  [[ -n "${ADMIN_EMAIL:-}" ]] && docker compose exec -T gpay node dist/cli.js create-admin "$ADMIN_EMAIL" "Администратор"
fi

echo
bold "Готово!  Откройте https://$GPAY_DOMAIN"
info "Обновление вместе с порталом:  sudo ./deploy/update.sh"
