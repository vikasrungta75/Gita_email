#!/bin/sh
# Back up the local Gita Mail database to data/backup/gitamail-YYYY-MM-DD.dump
cd "$(dirname "$0")/.." || exit 1
f="gitamail-$(date +%Y-%m-%d).dump"
docker compose exec -T db pg_dump -U gitamail -d gitamail -Fc -f "/backup/$f" && echo "Saved data/backup/$f"
