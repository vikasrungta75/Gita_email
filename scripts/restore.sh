#!/usr/bin/env bash
# Restores a backup made by scripts/backup.sh. REPLACES everything in the database.
#   bash scripts/restore.sh backups/gitamail-2026-11-21-0130.dump
#   bash scripts/restore.sh gs://BUCKET/gitamail-2026-11-21-0130.dump
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:?Give the backup file (local path or gs:// address)}"
get() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- ; }
DATABASE_URL="${DATABASE_URL:-$(get DATABASE_URL)}"
if [[ "$SRC" == gs://* ]]; then gcloud storage cp "$SRC" /tmp/gitamail-restore.dump; SRC=/tmp/gitamail-restore.dump; fi
read -r -p "This replaces ALL data in the database with $SRC. Type RESTORE to continue: " ok
[ "$ok" = "RESTORE" ] || { echo "Cancelled"; exit 1; }
command -v systemctl >/dev/null && sudo systemctl stop gitamail 2>/dev/null || true
pg_restore --clean --if-exists --no-owner --dbname="${DATABASE_URL%%\?*}" "$SRC"
command -v systemctl >/dev/null && sudo systemctl start gitamail 2>/dev/null || true
echo "Restored from $SRC"
