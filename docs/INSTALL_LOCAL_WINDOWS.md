# Install Gita Mail on a Windows desktop

The desktop copy runs on your own computer with your own PostgreSQL. It reads the live Gita Press mailboxes, keeps
everything on this computer, and is opened at **http://localhost:8888**. About 20 minutes.

## What you need

* **Node.js 22 LTS**: https://nodejs.org → "LTS" → install with the defaults.
* **PostgreSQL 16 or newer**: https://www.postgresql.org/download/windows/ → install with the defaults. Remember the
  password you give the `postgres` user.
* **Git for Windows**: https://git-scm.com/download/win (to download and update the code).
* The Google Client ID and secret, and the service account key, from [GOOGLE_WORKSPACE_SETUP.md](GOOGLE_WORKSPACE_SETUP.md).
* Optional: an AI key (`ANTHROPIC_API_KEY`) for "Rewrite properly" and better analysis. Without it everything else works.

## Install

1. Open **PowerShell** and get the code (once):
   ```powershell
   cd C:\Vikproj
   git clone https://github.com/vikasrungta75/Gita_email.git
   cd Gita_email
   ```
   If the folder already exists from earlier: `cd C:\Vikproj\Gita_email` then `git pull`.
2. Run the installer:
   ```powershell
   powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1
   ```
   It asks for the `postgres` password, your email and a Gita Mail password, then:
   * creates the `gitamail` database and user,
   * writes `.env` with new secret keys,
   * installs the packages, builds the app and creates the tables,
   * makes Gita Mail start whenever you sign in to Windows (Task Scheduler: "Gita Mail"),
   * schedules a nightly backup at 21:00 into the `backups` folder (kept 30 days).
3. Open `.env` in Notepad and add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and (optional) `ANTHROPIC_API_KEY`.
   Then restart: Task Scheduler → **Gita Mail** → End, then Run (or sign out and in).
4. Open **http://localhost:8888**, sign in, go to **Settings → Mailboxes**, upload the service account key and add
   booksales@, manager@, retailsales@, mumbai@ and kalyan@gitapress.org.
5. **Settings → System status → Delete everything and rebuild** (first run only): clears the old mail, customers and uploads,
   then reads 90 days of mail again.
6. Upload the data: **Admin → Master data → Book list (Suchi)** and **Book links**, then **Stock and tracking** (orders,
   branch stock, main stock, Kalyan tracking) and **Customer database** (all customers, current year).

Already had the old version on this computer (`C:\Vikproj\Gita_email` with your own PostgreSQL)? Keep your `.env`
(especially `ENCRYPTION_KEY`, so mailboxes stay connected), `git pull`, then run the installer: it keeps an existing `.env`.

## Every day

* Gita Mail starts by itself when you sign in. Logs: `logs\gitamail.log`.
* Other computers in the office can use it if you set `HOST=0.0.0.0` in `.env` and open port 8888 in Windows Firewall;
  they then open `http://<this-computer's-name>:8888`.

## Update

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\update.ps1
```
It backs up, pulls the latest code, installs, builds, updates the tables and restarts.

## Back up and restore

* Backup now: `powershell -ExecutionPolicy Bypass -File deploy\windows\backup.ps1` (also runs nightly).
* Restore (replaces everything): `powershell -ExecutionPolicy Bypass -File deploy\windows\restore.ps1 backups\gitamail-2026-11-21-2100.dump`

## Check the setup

`npm run check` tests Node.js, `.env`, the PostgreSQL connection, the AI key and the build, and says how to fix anything wrong.
**http://localhost:8888/api/health** shows the same from the running app.

| Problem | Fix |
| --- | --- |
| "database not reachable" | PostgreSQL service not running (Services → postgresql-x64-16 → Start), or wrong password in `DATABASE_URL` |
| Page does not open | Task Scheduler → Gita Mail → Run; look in `logs\gitamail.log` |
| Mailboxes show token errors | `ENCRYPTION_KEY` changed: put the old value back, or reconnect the mailboxes |
| Suchi PDF Hindi titles look garbled | Normal on Windows (the cloud server reads them cleanly). Upload the Excel version, or rely on the Hindi titles from the book links file |
