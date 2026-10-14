#!/usr/bin/env bash
# Bobobank — игровой банк на том же VPS, где уже установлены портал и GPAY.
#
#   ./deploy/install-bobobank.sh                           # адрес bank.<домен портала>
#   BANK_DOMAIN=bank.example.com ./deploy/install-bobobank.sh
#
# Для своего домена заранее создайте DNS-запись A для BANK_DOMAIN на IP сервера.
# GPAY должен быть установлен раньше (deploy/install-gpay.sh): банк и GPAY связываются общим секретом.
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
grep -q '^GPAY_DOMAIN=' .env || die "GPAY не установлен — сначала ./deploy/install-gpay.sh"

bold "1/4  Настройки (.env)"
BANK_DOMAIN="${BANK_DOMAIN:-bank.${DOMAIN:?В .env нет DOMAIN}}"
BANK_PORT="${BANK_PORT:-8082}"
while [[ -z "$(grep '^BANK_PORT=' .env || true)" ]] && ss -ltnH "( sport = :$BANK_PORT )" | grep -q .; do BANK_PORT=$((BANK_PORT + 1)); done
umask 077
setenv BANK_DOMAIN "$BANK_DOMAIN"
setenv BANK_PORT "$BANK_PORT"
setenv BANK_DB_KEY "$(openssl rand -hex 32)"
setenv BANK_GPAY_SECRET "$(openssl rand -hex 32)"
setenv BANK_INTERNAL_URL "http://bobobank:8082"
setenv BANK_PUBLIC_URL "https://$BANK_DOMAIN"
add_profile gpay
add_profile bobobank
set -a; . ./.env; set +a
info "Адрес банка: https://$BANK_DOMAIN"
warn "В .env добавлены BANK_DB_KEY и BANK_GPAY_SECRET — сохраните копию .env: без ключа база банка не расшифруется."
mkdir -p bobobank-data && chown 1000:1000 bobobank-data && chmod 700 bobobank-data

bold "2/4  Запуск (банк и GPAY с подключённым банком)"
docker compose up -d --build
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$BANK_PORT/api/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "http://127.0.0.1:$BANK_PORT/api/health" >/dev/null || die "Bobobank не отвечает. Логи: docker compose logs bobobank"
info "Bobobank запущен на 127.0.0.1:$BANK_PORT."

bold "3/4  HTTPS"
if [[ ",$COMPOSE_PROFILES," == *",caddy,"* ]]; then
  if ! grep -q 'BANK_DOMAIN' deploy/Caddyfile; then
    printf '\n{$BANK_DOMAIN:bank.localhost} {\n\tencode zstd gzip\n\trespond /internal/* 404\n\treverse_proxy bobobank:8082\n}\n' >>deploy/Caddyfile
    info "В deploy/Caddyfile добавлен блок для банка."
  fi
  docker compose up -d caddy >/dev/null
  docker compose restart caddy >/dev/null
  info "Caddy выпустит сертификат для $BANK_DOMAIN автоматически."
elif command -v nginx >/dev/null 2>&1; then
  CONF=/etc/nginx/sites-available/bobobank.conf
  info "Будет создан $CONF (server_name $BANK_DOMAIN → 127.0.0.1:$BANK_PORT) и выпущен сертификат certbot."
  if ask "Применить изменения nginx?"; then
    sed -e "s/__DOMAIN__/$BANK_DOMAIN/" -e "s/__APP_PORT__/$BANK_PORT/" deploy/nginx-bobobank.conf.template >"$CONF"
    ln -sf "$CONF" /etc/nginx/sites-enabled/bobobank.conf
    nginx -t && systemctl reload nginx
    command -v certbot >/dev/null 2>&1 || apt-get install -y certbot python3-certbot-nginx
    if [[ -n "${ACME_EMAIL:-}" ]]; then EMAIL_ARGS=(--email "$ACME_EMAIL"); else EMAIL_ARGS=(--register-unsafely-without-email); fi
    certbot --nginx -d "$BANK_DOMAIN" --non-interactive --agree-tos --redirect "${EMAIL_ARGS[@]}"
  else
    warn "nginx не изменён. Проксируйте $BANK_DOMAIN на 127.0.0.1:$BANK_PORT вручную (пример: deploy/nginx-bobobank.conf.template)."
  fi
else
  warn "Настройте прокси $BANK_DOMAIN → 127.0.0.1:$BANK_PORT с HTTPS вручную."
fi

bold "4/4  Администратор банка"
if docker compose exec -T bobobank node dist/cli.js has-admins >/dev/null 2>&1; then
  info "Администратор уже есть — пропускаю."
else
  read -r -p "  Телефон администратора (+7…): " ADMIN_PHONE </dev/tty || true
  [[ -n "${ADMIN_PHONE:-}" ]] && docker compose exec -T bobobank node dist/cli.js create-admin "$ADMIN_PHONE" "Администратор банка"
fi

echo
bold "Готово!  Откройте https://$BANK_DOMAIN"
info "Карты банка уже принимаются в GPAY (https://$GPAY_DOMAIN), выплаты продавцам — на счета Bobobank."
info "Обновление вместе с порталом:  ./deploy/update.sh"
