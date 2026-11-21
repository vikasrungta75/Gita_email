# Install Gita Mail on Google Cloud

One small Google Compute Engine VM in Mumbai (`asia-south1`) runs everything: the Node.js app, a **self-managed
PostgreSQL** (on the same VM, listening on localhost only), and **nginx** with HTTPS in front. A nightly database backup
goes to a Cloud Storage bucket and is kept 30 days. Expected cost: an e2-small VM, a 30 GB disk, a static IP and a few GB
of backups, roughly US$20–25 a month (covered by Google for Startups credits).

## One command

From **Google Cloud Shell** (https://shell.cloud.google.com, already signed in) or any computer with `gcloud`:

```bash
git clone https://github.com/vikasrungta75/Gita_email.git && cd Gita_email
PROJECT=your-gcp-project-id DOMAIN=mail.gitapress.org ADMIN_EMAIL=you@gitapress.org bash deploy/gcp/create-vm.sh
```

If the repository is private, add `GITHUB_TOKEN=<a fine-grained read-only token for this repository>` in front.

The script:
1. enables Compute Engine and Cloud Storage,
2. creates a service account for the VM that can only write backups,
3. creates the backup bucket `<project>-gitamail-backups` with 30-day deletion,
4. reserves a fixed IP address and opens ports 80 and 443 (SSH only through Google's IAP),
5. creates the VM `gitamail` (Ubuntu 24.04, e2-small, 30 GB),
6. runs [deploy/gcp/setup-vm.sh](../deploy/gcp/setup-vm.sh) on it, which installs Node.js 22, PostgreSQL 16, nginx, certbot
   and poppler (for the Suchi PDF), creates the database with a random password, writes `.env` with new secret keys and a
   first admin password (printed once: change it after signing in), builds the app, starts it as the `gitamail` systemd
   service, configures nginx and schedules the nightly backup (01:30 IST).

It prints the IP address at the end.

## Then

1. **DNS**: create an A record for `mail.gitapress.org` pointing to the IP address.
2. **HTTPS** (after DNS works):
   ```bash
   gcloud compute ssh gitamail --zone asia-south1-a --tunnel-through-iap
   sudo certbot --nginx -d mail.gitapress.org --redirect -m you@gitapress.org --agree-tos -n
   ```
3. **Settings**: `sudo nano /opt/gitamail/.env` → add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (redirect URIs for your
   domain, see [GOOGLE_WORKSPACE_SETUP.md](GOOGLE_WORKSPACE_SETUP.md)) and optional `ANTHROPIC_API_KEY`; then
   `sudo systemctl restart gitamail`.
4. Open `https://mail.gitapress.org`, sign in, add the mailboxes, set up the AI in **Settings → AI**, and upload the
   data (same as steps 4–6 of the desktop guide).

## Update to the latest code

```bash
gcloud compute ssh gitamail --zone asia-south1-a --tunnel-through-iap
sudo bash /opt/gitamail/scripts/deploy.sh
```
It backs up, pulls `main`, installs, builds, updates the tables, restarts and checks `/api/health`.

## Logs, backups, restore

* Logs: `journalctl -u gitamail -f`
* Backup now: `sudo -u gitamail bash /opt/gitamail/scripts/backup.sh` (local copy in `/var/backups/gitamail`, plus the bucket)
* Restore (replaces everything): `cd /opt/gitamail && sudo bash scripts/restore.sh gs://<bucket>/gitamail-2026-11-21-2000.dump`
* Health: `curl -s localhost:8888/api/health`

## Moving data between the desktop and the cloud

Back up on one (`backup.ps1` / `backup.sh`), copy the `.dump` file, restore on the other with `restore.ps1` /
`restore.sh`. Copy `ENCRYPTION_KEY` and `JWT_SECRET` from the source `.env` too, otherwise mailboxes must be reconnected.
Run only one copy against the same mailboxes at a time.
