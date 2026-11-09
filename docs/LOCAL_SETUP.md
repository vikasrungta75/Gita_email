# Gita Mail on your own computer (local edition)

The local edition runs the whole of Gita Mail on one computer: the web app, the database and the
background worker that reads mail every 5 minutes. Nothing runs on Netlify. Your mail, analysis and
drafts are stored in a folder on your disk (`data/postgres`).

You use the same `.env` file as the Netlify site. Two settings are handled for you:

* `DATABASE_URL` is replaced by the local database (Docker route), or you set it once (no-Docker route).
* `APP_URL` becomes `http://localhost:8888` automatically.

---

## 1. What you need

| | Minimum |
|---|---|
| Computer | Windows 10 or 11, macOS 12 or later, or Linux |
| Memory and disk | 8 GB RAM; 10 GB free disk (more if you keep years of mail) |
| Internet | Needed: the app reads Gmail and calls Claude over the internet |
| Software | **Route A (recommended):** Docker Desktop. **Route B:** Node.js 22 and PostgreSQL 17 |

The computer must be switched on and awake for mail to be read. If it sleeps, reading resumes when it wakes.

---

## 2. Get the code

Either:

* GitHub: open `github.com/vikasrungta75/Gita_email`, choose **Code → Download ZIP**, and unzip it, or
* if you have Git: `git clone https://github.com/vikasrungta75/Gita_email.git`

Open a terminal (Windows: PowerShell; Mac: Terminal) **in that folder** for every command below.

---

## 3. Put your settings file in place

1. Download the environment file from the **Gita Mail** Netlify site
   (Site configuration → Environment variables → Download). Check the top of the site page names
   the Gita Mail site, not Wheel King.
2. Save it in the code folder with the name `.env` (Windows: make sure it is not `.env.txt`).
3. Open it and check these lines:

| Setting | What it should be |
|---|---|
| `ORG_NAME` | Gita Press, Gorakhpur |
| `INTERNAL_DOMAINS` | gitapress.org |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The admin sign-in you want locally |
| `JWT_SECRET`, `ENCRYPTION_KEY`, `INTERNAL_API_SECRET` | **Keep exactly as on Netlify** if you will copy the cloud data. `ENCRYPTION_KEY` unlocks the stored Gmail connections and service account key; a different key means reconnecting them |
| `ANTHROPIC_API_KEY`, `AI_PROVIDER` | Your Claude key; `anthropic` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Same as Netlify |

---

## 4. Allow sign-in with Google on your computer (one time)

In Google Cloud Console → **APIs & Services → Credentials → your OAuth client**:

* Authorised JavaScript origins: add `http://localhost:8888`
* Authorised redirect URIs: add `http://localhost:8888/api/auth/google/callback`

Keep the Netlify entries if the cloud site stays on. The service account used for the shared
mailboxes (booksales@, retailsales@, mumbai@, manager@) needs no change.

---

## 5A. Start with Docker (recommended)

1. Install **Docker Desktop** from docker.com and start it (wait until it shows "running").
2. Optional: bring across everything already in the cloud (mail, analysis, drafts, customers, settings).
   In Netlify, copy the **unpooled** database connection string (`NETLIFY_DATABASE_URL_UNPOOLED`), then run:
   * Mac or Linux: `sh local/import-from-cloud.sh "postgres://...unpooled string..."`
   * Windows: `local\import-from-cloud.bat "postgres://...unpooled string..."`
3. Start Gita Mail:

   ```
   docker compose up -d --build
   ```

   The first start takes a few minutes while it downloads and builds.
4. Open **http://localhost:8888** and sign in with your admin email and password, or with Google.
5. Go to **Settings → System status**: after about 5 minutes the counts start rising.

Everyday commands:

| Task | Command |
|---|---|
| See what it is doing | `docker compose logs -f app` |
| Stop | `docker compose down` |
| Start again | `docker compose up -d` |
| Update to a new version | Download the new code (or `git pull`), then `docker compose up -d --build` |
| Back up the database | Mac/Linux `sh local/backup.sh`, Windows `local\backup.bat` (saved in `data/backup`) |

Docker Desktop restarts Gita Mail automatically when the computer starts, if Docker Desktop is set
to start at login (Docker Desktop → Settings → General).

---

## 5B. Start without Docker

Full step-by-step guide for computers that already have PostgreSQL and Node.js: [LOCAL_SETUP_NODE.md](LOCAL_SETUP_NODE.md). Short version:

1. Install **Node.js 22 LTS** from nodejs.org.
2. Install **PostgreSQL 17** (Windows: the EDB installer from postgresql.org; Mac: Postgres.app).
   Note the password you set for the `postgres` user.
3. Create the database: open the PostgreSQL shell (or pgAdmin) and run `CREATE DATABASE gitamail;`
4. In `.env`, change the database line to:

   ```
   DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/gitamail
   ```

5. Install and start:

   ```
   npm ci
   npm run local:start
   ```

6. Open **http://localhost:8888**. Keep the terminal window open; closing it stops Gita Mail.
   Next time, `npm run local` starts it without rebuilding.

To copy the cloud data in this route: `pg_dump "UNPOOLED_STRING" -Fc --no-owner --no-acl -f cloud.dump`
then `pg_restore -d gitamail --no-owner --no-acl --clean --if-exists cloud.dump`.

---

## 6. Important before you rely on it

* **Run one copy, not two.** If the Netlify site keeps running with the same mailboxes, both will read
  mail and both may send alerts. Once the local copy works, stop the Netlify one
  (Netlify → Site configuration → Build & deploy → Stop builds, and remove the scheduled function,
  or delete the site after a final backup).
* **Only this computer can open it.** The app and the database listen on this computer only. To let
  colleagues on the office network use it, change `127.0.0.1:8888:8888` to `8888:8888` in
  `docker-compose.yml`, set `LOCAL_APP_URL=http://<this-computer-name>:8888` in `.env`, add that address
  to the Google OAuth client, and restart. Google sign-in only accepts `http://` for `localhost`; for
  other addresses you need `https://`.
* **Protect the disk.** Mail is stored in `data/postgres`. Turn on BitLocker (Windows) or FileVault (Mac),
  and copy `data/backup` to another drive regularly.
* **The `.env` file holds keys.** Do not email it or put it in a shared folder.

---

## 7. Troubleshooting

| Problem | Fix |
|---|---|
| `database not reachable` | Docker: run `docker compose ps`; the `db` line should say healthy. No Docker: check PostgreSQL is running and `DATABASE_URL` is right |
| Google sign-in says `redirect_uri_mismatch` | Add the localhost entries in step 4 exactly as written |
| Gmail mailboxes show token errors after importing | `ENCRYPTION_KEY` differs from Netlify. Put the Netlify value back, or reconnect the mailboxes in Admin → Mailboxes |
| Banner "Claude analysis is paused" | Check `ANTHROPIC_API_KEY` in `.env` and the credit on console.anthropic.com, then `docker compose up -d` |
| Port 8888 already in use | Set `PORT=8899` (no Docker) or change the left-hand port in `docker-compose.yml` |
| Nothing new after an hour | Look at `docker compose logs -f app` for `[worker]` lines; check the computer did not sleep |
