#!/usr/bin/env bash
# Бобуслуги — сайт госуслуг на том же VPS, рядом с Bobobank и GPAY. База остаётся в Supabase.
#
#   ./deploy/install-bobuslugi.sh                        # адрес gos.<домен портала>
#   GOS_DOMAIN=gos.example.com ./deploy/install-bobuslugi.sh
#
# Заранее: DNS-запись A для GOS_DOMAIN на IP сервера; в Supabase → Project Settings → API
# возьмите Project URL, ключ anon (publishable) и ключ service_role (secret).
# Bobobank и GPAY должны быть установлены раньше.
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
setenv() { # setenv KEY VALUE — добавляет или заменяет ключ в .env
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >>.env; fi
}
prompt() { # prompt VAR "Вопрос" — спрашивает, если переменной нет в окружении и в .env
  local cur
  cur="$(grep "^$1=" .env | cut -d= -f2- || true)"
  if [[ -n "${!1:-}" ]]; then return; fi
  if [[ -n "$cur" ]]; then printf -v "$1" '%s' "$cur"; return; fi
  read -r -p "  $2: " "$1" </dev/tty || true
  [[ -n "${!1:-}" ]] || die "Нужно указать $1"
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

bold "1/5  Код Бобуслуг"
REPO="${BOBUSLUGI_REPO:-https://github.com/bobopsya/bobuslugi.git}"
BRANCH="${BOBUSLUGI_BRANCH:-}"
if [[ -d bobuslugi/.git ]]; then
  git -C bobuslugi pull --ff-only
else
  git clone ${BRANCH:+--branch "$BRANCH"} "$REPO" bobuslugi
fi
info "Репозиторий: bobuslugi/ ($(git -C bobuslugi rev-parse --short HEAD))"

bold "2/5  Настройки (.env)"
GOS_DOMAIN="${GOS_DOMAIN:-$(grep '^GOS_DOMAIN=' .env | cut -d= -f2- || true)}"
GOS_DOMAIN="${GOS_DOMAIN:-gos.${DOMAIN:?В .env нет DOMAIN}}"
prompt SUPABASE_URL "Supabase Project URL (https://xxxx.supabase.co)"
prompt SUPABASE_ANON_KEY "Supabase anon / publishable ключ"
prompt SUPABASE_SERVICE_KEY "Supabase service_role / secret ключ (останется только на сервере)"
GOS_PORT="${GOS_PORT:-8083}"
while [[ -z "$(grep '^GOS_PORT=' .env || true)" ]] && ss -ltnH "( sport = :$GOS_PORT )" | grep -q .; do GOS_PORT=$((GOS_PORT + 1)); done
umask 077
setenv GOS_DOMAIN "$GOS_DOMAIN"
setenv GOS_PORT "$GOS_PORT"
setenv GOS_PUBLIC_URL "https://$GOS_DOMAIN"
setenv SUPABASE_URL "${SUPABASE_URL%/}"
setenv SUPABASE_ANON_KEY "$SUPABASE_ANON_KEY"
setenv SUPABASE_SERVICE_KEY "$SUPABASE_SERVICE_KEY"
add_profile bobuslugi
set -a; . ./.env; set +a
warn "SUPABASE_SERVICE_KEY даёт полный доступ к базе Бобуслуг — не публикуйте .env."

bold "3/5  Сборка и запуск"
docker compose up -d --build
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$GOS_PORT/" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "http://127.0.0.1:$GOS_PORT/" >/dev/null || die "Бобуслуги не отвечают. Логи: docker compose logs bobuslugi"
info "Бобуслуги запущены на 127.0.0.1:$GOS_PORT, банк и GPAY перезапущены с ключами Supabase."

bold "4/5  HTTPS"
if [[ ",$COMPOSE_PROFILES," == *",caddy,"* ]]; then
  if ! grep -q 'GOS_DOMAIN' deploy/Caddyfile; then
    printf '\n{$GOS_DOMAIN:gos.localhost} {\n\tencode zstd gzip\n\treverse_proxy bobuslugi:80\n}\n' >>deploy/Caddyfile
    info "В deploy/Caddyfile добавлен блок для Бобуслуг."
  fi
  docker compose up -d caddy >/dev/null
  docker compose restart caddy >/dev/null
  info "Caddy выпустит сертификат для $GOS_DOMAIN автоматически."
elif command -v nginx >/dev/null 2>&1; then
  CONF=/etc/nginx/sites-available/bobuslugi.conf
  info "Будет создан $CONF (server_name $GOS_DOMAIN → 127.0.0.1:$GOS_PORT) и выпущен сертификат certbot."
  if ask "Применить изменения nginx?"; then
    sed -e "s/__DOMAIN__/$GOS_DOMAIN/" -e "s/__APP_PORT__/$GOS_PORT/" deploy/nginx-bobuslugi.conf.template >"$CONF"
    ln -sf "$CONF" /etc/nginx/sites-enabled/bobuslugi.conf
    nginx -t && systemctl reload nginx
    command -v certbot >/dev/null 2>&1 || apt-get install -y certbot python3-certbot-nginx
    if [[ -n "${ACME_EMAIL:-}" ]]; then EMAIL_ARGS=(--email "$ACME_EMAIL"); else EMAIL_ARGS=(--register-unsafely-without-email); fi
    certbot --nginx -d "$GOS_DOMAIN" --non-interactive --agree-tos --redirect "${EMAIL_ARGS[@]}"
  else
    warn "nginx не изменён. Проксируйте $GOS_DOMAIN на 127.0.0.1:$GOS_PORT вручную (пример: deploy/nginx-bobuslugi.conf.template)."
  fi
else
  warn "Настройте прокси $GOS_DOMAIN → 127.0.0.1:$GOS_PORT с HTTPS вручную."
fi

bold "5/5  База Supabase"
info "Примените новые миграции из bobuslugi/supabase/migrations/ (SQL Editor в Supabase — по порядку имён,"
info "только те, что ещё не выполняли), если их не применяет GitHub Actions самих Бобуслуг."
info "В Supabase → Authentication → URL Configuration добавьте https://$GOS_DOMAIN в Site URL."

echo
bold "Готово!  Откройте https://$GOS_DOMAIN"
info "В банке и GPAY появилась кнопка «Войти через Бобуслуги»; новые счета открываются по Бобопаспорту."
info "Обновление вместе с порталом:  ./deploy/update.sh"
