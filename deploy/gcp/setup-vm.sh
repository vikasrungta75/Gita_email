#!/usr/bin/env bash
# Installs or upgrades Gita Mail on an Ubuntu 24.04 VM: Node.js 22, PostgreSQL 16 (self-managed, local
# only), nginx, the app under /opt/gitamail as a systemd service, and the nightly backup to Cloud Storage.
# Safe to run again: existing settings (.env) and the database are kept.
#   sudo DOMAIN=mail.gitapress.org ADMIN_EMAIL=you@gitapress.org BACKUP_BUCKET=bucket bash setup-vm.sh
set -euo pipefail
DOMAIN="${DOMAIN:?}"; ADMIN_EMAIL="${ADMIN_EMAIL:?}"
BACKUP_BUCKET="${BACKUP_BUCKET:-}"
REPO_URL="${REPO_URL:-https://github.com/vikasrungta75/Gita_email.git}"
APP=/opt/gitamail
export DEBIAN_FRONTEND=noninteractive

echo "==> Packages"
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg git nginx postgresql postgresql-contrib certbot python3-certbot-nginx poppler-utils
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi

echo "==> User and folders"
id gitamail >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/gitamail --shell /usr/sbin/nologin gitamail
mkdir -p "$APP" /var/backups/gitamail
chown gitamail:gitamail /var/backups/gitamail

echo "==> Code"
if [ ! -d "$APP/.git" ]; then
  URL="$REPO_URL"
  if [ -n "${GITHUB_TOKEN:-}" ]; then URL="${REPO_URL/https:\/\//https://x-access-token:${GITHUB_TOKEN}@}"; fi
  git clone --depth 1 "$URL" "$APP"
  git -C "$APP" remote set-url origin "$REPO_URL"
fi
chown -R gitamail:gitamail "$APP"

echo "==> PostgreSQL (listens on localhost only)"
systemctl enable --now postgresql
if ! sudo -u postgres psql -tAc "select 1 from pg_roles where rolname='gitamail'" | grep -q 1; then
  DBPASS=$(openssl rand -hex 24)
  sudo -u postgres psql -c "create user gitamail with password '$DBPASS';"
  sudo -u postgres psql -c "create database gitamail owner gitamail;"
  echo "$DBPASS" > /root/.gitamail-dbpass; chmod 600 /root/.gitamail-dbpass
fi
DBPASS=$(cat /root/.gitamail-dbpass 2>/dev/null || true)

echo "==> Settings (.env)"
if [ ! -f "$APP/.env" ]; then
  ADMIN_PASSWORD=$(openssl rand -base64 12 | tr -d '/+=')1a
  cp "$APP/.env.example" "$APP/.env"
  set_env() { sed -i "s|^$1=.*|$1=$2|" "$APP/.env"; }
  set_env DATABASE_URL "postgres://gitamail:${DBPASS}@localhost:5432/gitamail?sslmode=disable"
  set_env JWT_SECRET "$(openssl rand -hex 32)"
  set_env ENCRYPTION_KEY "$(openssl rand -hex 32)"
  set_env INTERNAL_API_SECRET "$(openssl rand -hex 24)"
  set_env APP_URL "https://${DOMAIN}"
  set_env HOST 127.0.0.1
  set_env APP_ROLE cloud
  set_env ADMIN_EMAIL "$ADMIN_EMAIL"
  set_env ADMIN_PASSWORD "$ADMIN_PASSWORD"
  set_env ADMIN_NAME "Administrator"
  set_env BACKUP_BUCKET "$BACKUP_BUCKET"
  echo "First administrator: $ADMIN_EMAIL  password: $ADMIN_PASSWORD  (change it after signing in)"
fi
chown gitamail:gitamail "$APP/.env"; chmod 600 "$APP/.env"

echo "==> Install and build"
cd "$APP"
sudo -u gitamail npm ci --no-audit --no-fund
sudo -u gitamail npm run build
sudo -u gitamail npm run migrate

echo "==> Service"
cp "$APP/deploy/gcp/gitamail.service" /etc/systemd/system/gitamail.service
systemctl daemon-reload
systemctl enable gitamail
systemctl restart gitamail

echo "==> nginx"
sed "s|__DOMAIN__|${DOMAIN}|g" "$APP/deploy/gcp/nginx.conf" > /etc/nginx/sites-available/gitamail
ln -sf /etc/nginx/sites-available/gitamail /etc/nginx/sites-enabled/gitamail
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> Nightly backup at 01:30 IST (20:00 UTC)"
cat > /etc/cron.d/gitamail-backup <<CRON
0 20 * * * gitamail cd $APP && /usr/bin/bash scripts/backup.sh >> /var/log/gitamail-backup.log 2>&1
CRON
touch /var/log/gitamail-backup.log; chown gitamail:gitamail /var/log/gitamail-backup.log

echo "==> Done. Status:"
systemctl --no-pager --lines=5 status gitamail || true
