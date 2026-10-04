#!/usr/bin/env bash
# Обновляет портал до последней версии из git и перезапускает контейнеры. Данные и .env не трогаются.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "Нет .env — сначала запустите deploy/install.sh" >&2; exit 1; }
git pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null
echo "Портал обновлён."
