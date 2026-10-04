#!/usr/bin/env bash
# ZhukoNet portal — установка на VPS (Ubuntu / Debian).
#
#   sudo ./deploy/install.sh                       # домен <ip>.sslip.io
#   sudo DOMAIN=portal.example.com ./deploy/install.sh
#
# Скрипт ничего не меняет в существующем веб-сервере без вашего подтверждения.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ask() {
  local answer
  read -r -p "$1 [y/N] " answer </dev/tty || true
  [[ "$answer" =~ ^[YyДд] ]]
}

[[ $EUID -eq 0 ]] || die "Запустите от root: sudo $0"
. /etc/os-release 2>/dev/null || true
[[ "${ID:-}" =~ ^(ubuntu|debian)$ || "${ID_LIKE:-}" =~ debian ]] || warn "Скрипт проверялся на Ubuntu/Debian, у вас: ${PRETTY_NAME:-неизвестно}"

bold "1/6  Docker"
if ! command -v docker >/dev/null 2>&1; then
  info "Docker не найден."
  ask "Установить Docker (официальный скрипт get.docker.com)?" || die "Без Docker продолжить нельзя."
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || die "Нет плагина 'docker compose'. Установите docker-compose-plugin."
info "$(docker --version)"

bold "2/6  Домен"
PUBLIC_IP="${PUBLIC_IP:-$(curl -4fsS --max-time 5 https://api.ipify.org || curl -4fsS --max-time 5 https://ifconfig.me || true)}"
[[ -n "$PUBLIC_IP" ]] || die "Не удалось определить внешний IP. Задайте вручную: PUBLIC_IP=1.2.3.4"
DOMAIN="${DOMAIN:-${PUBLIC_IP//./-}.sslip.io}"
info "IP: $PUBLIC_IP"
info "Адрес портала: https://$DOMAIN"

bold "3/6  Порты 80/443"
PORT_USERS="$(ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null | grep -o 'users:(("[^"]*"' | cut -d'"' -f2 | sort -u | tr '\n' ' ' || true)"
MODE=""
if [[ -z "$PORT_USERS" ]]; then
  MODE="caddy"
  info "Порты свободны → будет использован Caddy (автоматический HTTPS от Let's Encrypt)."
elif [[ "$PORT_USERS" == *nginx* ]] && command -v nginx >/dev/null 2>&1; then
  MODE="nginx"
  info "Порты занимает nginx → портал будет добавлен отдельным server-блоком, сертификат через certbot."
else
  warn "Порты 80/443 заняты: ${PORT_USERS:-неизвестный процесс}."
  info "Автоматическая настройка невозможна, ничего не меняю."
  info "Вручную: запустите портал (docker compose up -d) и проксируйте ваш веб-сервер на 127.0.0.1:8080"
  info "для домена $DOMAIN с HTTPS. Пример конфигурации: deploy/nginx-zhukonet.conf.template"
  exit 1
fi

bold "4/6  Настройки (.env)"
if [[ -f .env ]]; then
  info ".env уже существует — ключи не трогаю."
  grep -q '^DOMAIN=' .env || echo "DOMAIN=$DOMAIN" >>.env
else
  APP_PORT=8080
  while ss -ltnH "( sport = :$APP_PORT )" | grep -q .; do APP_PORT=$((APP_PORT + 1)); done
  umask 077
  cat >.env <<EOF
# Сгенерировано install.sh $(date -Iseconds). НЕ ПОТЕРЯЙТЕ ЭТИ КЛЮЧИ: без них база и файлы не расшифруются.
DB_KEY=$(openssl rand -hex 32)
FILES_KEY=$(openssl rand -hex 32)
DOMAIN=$DOMAIN
APP_PORT=$APP_PORT
COMPOSE_PROFILES=$([[ $MODE == caddy ]] && echo caddy)
EOF
  info "Созданы новые ключи шифрования в $ROOT/.env (права 600)."
  warn "Сохраните копию .env в надёжном месте (менеджер паролей, сейф) — она нужна для восстановления из бэкапа."
fi
set -a; . ./.env; set +a
mkdir -p data && chown 1000:1000 data && chmod 700 data

bold "5/6  Запуск"
docker compose up -d --build
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:${APP_PORT:-8080}/api/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "http://127.0.0.1:${APP_PORT:-8080}/api/health" >/dev/null || die "Портал не отвечает. Логи: docker compose logs app"
info "Портал запущен на 127.0.0.1:${APP_PORT:-8080}."

if [[ $MODE == nginx ]]; then
  CONF=/etc/nginx/sites-available/zhukonet.conf
  echo
  bold "Будут выполнены изменения nginx:"
  info "• создан $CONF (server_name $DOMAIN → 127.0.0.1:${APP_PORT:-8080})"
  info "• ссылка в /etc/nginx/sites-enabled/, проверка nginx -t, reload"
  info "• certbot --nginx -d $DOMAIN (бесплатный сертификат Let's Encrypt)"
  info "Существующие сайты не изменяются."
  if [[ -e $CONF ]]; then warn "$CONF уже существует и будет перезаписан."; fi
  ask "Применить?" || die "Отменено. Портал работает локально на 127.0.0.1:${APP_PORT:-8080}."
  sed -e "s/__DOMAIN__/$DOMAIN/" -e "s/__APP_PORT__/${APP_PORT:-8080}/" deploy/nginx-zhukonet.conf.template >"$CONF"
  ln -sf "$CONF" /etc/nginx/sites-enabled/zhukonet.conf
  nginx -t && systemctl reload nginx
  command -v certbot >/dev/null 2>&1 || apt-get install -y certbot python3-certbot-nginx
  if [[ -n "${ACME_EMAIL:-}" ]]; then EMAIL_ARGS=(--email "$ACME_EMAIL"); else EMAIL_ARGS=(--register-unsafely-without-email); fi
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect "${EMAIL_ARGS[@]}"
fi

bold "6/6  Первый пользователь"
if docker compose exec -T app node dist/cli.js has-users >/dev/null 2>&1; then
  info "Пользователи уже есть — пропускаю."
else
  read -r -p "  Логин администратора [admin]: " ADMIN_LOGIN </dev/tty || true
  read -r -p "  ФИО: " ADMIN_NAME </dev/tty || true
  docker compose exec -T app node dist/cli.js create-user "${ADMIN_LOGIN:-admin}" "${ADMIN_NAME:-Администратор}"
fi

echo
bold "Готово!  Откройте https://$DOMAIN"
info "Если сертификат ещё выпускается, подождите минуту и обновите страницу."
info "Обновление портала:  sudo ./deploy/update.sh"
