#!/usr/bin/env bash
# Updates the Gita Mail server to the latest code on main: backup, pull, install, build, migrate, restart.
# Run on the Google Cloud VM:  sudo bash /opt/gitamail/scripts/deploy.sh
set -euo pipefail
APP="${APP:-/opt/gitamail}"
BRANCH="${BRANCH:-main}"
cd "$APP"
echo "==> Backup first"
sudo -u gitamail bash scripts/backup.sh
echo "==> Code ($BRANCH)"
sudo -u gitamail git fetch --depth 1 origin "$BRANCH"
sudo -u gitamail git reset --hard "origin/$BRANCH"
echo "==> Install, build, migrate"
sudo -u gitamail npm ci --no-audit --no-fund
sudo -u gitamail npm run build
sudo -u gitamail npm run migrate
cp deploy/gcp/gitamail.service /etc/systemd/system/gitamail.service && systemctl daemon-reload
systemctl restart gitamail
sleep 3
curl -fsS http://127.0.0.1:8888/api/health >/dev/null && echo "==> Gita Mail is running" || { echo "Health check failed: journalctl -u gitamail -n 50"; exit 1; }
