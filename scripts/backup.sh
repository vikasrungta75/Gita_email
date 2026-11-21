#!/usr/bin/env bash
# Backs up the Gita Mail database (pg_dump custom format) to backups/ (or BACKUP_DIR), copies it to the
# Cloud Storage bucket in BACKUP_BUCKET when set, and removes local copies older than BACKUP_KEEP_DAYS.
#   bash scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
get() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- ; }
DATABASE_URL="${DATABASE_URL:-$(get DATABASE_URL)}"
BACKUP_BUCKET="${BACKUP_BUCKET:-$(get BACKUP_BUCKET)}"
KEEP="${BACKUP_KEEP_DAYS:-$(get BACKUP_KEEP_DAYS)}"; KEEP="${KEEP:-30}"
DIR="${BACKUP_DIR:-/var/backups/gitamail}"; [ -w "$DIR" ] || DIR="backups"
mkdir -p "$DIR"
FILE="$DIR/gitamail-$(date +%Y-%m-%d-%H%M).dump"
pg_dump --format=custom --no-owner --dbname="${DATABASE_URL%%\?*}" --file="$FILE"
echo "saved $FILE ($(du -h "$FILE" | cut -f1))"
if [ -n "$BACKUP_BUCKET" ]; then
  gcloud storage cp "$FILE" "gs://$BACKUP_BUCKET/" && echo "copied to gs://$BACKUP_BUCKET/"
fi
find "$DIR" -name 'gitamail-*.dump' -mtime "+$KEEP" -delete
