#!/bin/sh
# Copy the existing Gita Mail database from Netlify (cloud) into the local database.
# Usage: sh local/import-from-cloud.sh "postgres://...cloud connection string..."
# Use the UNPOOLED connection string from Netlify (NETLIFY_DATABASE_URL_UNPOOLED).
cd "$(dirname "$0")/.." || exit 1
CLOUD="$1"
[ -z "$CLOUD" ] && echo "Give the cloud database connection string in quotes" && exit 1
mkdir -p data/backup
echo "1/3 Downloading the cloud database..."
docker run --rm -v "$PWD/data/backup:/backup" postgres:17 pg_dump "$CLOUD" -Fc --no-owner --no-acl -f /backup/cloud.dump || exit 1
echo "2/3 Starting the local database..."
docker compose up -d db && sleep 5
echo "3/3 Restoring into the local database..."
docker compose exec -T db pg_restore -U gitamail -d gitamail --no-owner --no-acl --clean --if-exists /backup/cloud.dump
echo "Done. Now run: docker compose up -d --build"
