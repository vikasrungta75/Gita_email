# Gita Mail on your computer, with your own PostgreSQL and Node.js

Step-by-step guide for a computer that already has PostgreSQL and Node.js. No Docker needed.
At the end you will have the full product running at **http://localhost:8888**: Gmail reading every
5 minutes, Claude analysis, reply drafts, alerts and reports, with all data in your own PostgreSQL.

Commands are given for **Windows (PowerShell)** and **Mac**. Type them exactly, one at a time.

---

## Step 1. Check what you have (2 minutes)

Open a terminal (Windows: Start → type **PowerShell**; Mac: Applications → Utilities → **Terminal**) and run:

```
node -v
```

You need **v20.12 or later** (v22 recommended). If it says older, or "not recognised", install
**Node.js 22 LTS** from nodejs.org and open a new terminal.

```
npm -v
```

Any number is fine.

For PostgreSQL you need: the **port** (normally 5432), the **user** (normally `postgres`) and its
**password**, the one you chose when installing. PostgreSQL 14 or later works; 16 or 17 is ideal.
Make sure it is running:

* Windows: Start → **Services** → "postgresql-x64-…" should be **Running**
* Mac (Postgres.app): the elephant icon in the menu bar shows "Running"

---

## Step 2. Get the code (2 minutes)

1. Unzip **gita-mail-local.zip** (or download the ZIP from github.com/vikasrungta75/Gita_email → Code → Download ZIP).
2. Move the folder somewhere simple, for example `C:\GitaMail` (Windows) or `~/GitaMail` (Mac).
3. Open a terminal **in that folder**:
   * Windows: open the folder in File Explorer, click the address bar, type `powershell` and press Enter
   * Mac: right-click the folder in Finder → **New Terminal at Folder**

---

## Step 3. Install the packages (3 to 5 minutes)

```
npm ci
```

Wait until it finishes. Warnings are normal; an "ERR!" line is not (see Troubleshooting).

---

## Step 4. Create the settings file .env (10 minutes)

1. Make your `.env` from the template:
   * Windows: `copy local\env.local.template .env`
   * Mac: `cp local/env.local.template .env`
2. Open it:
   * Windows: `notepad .env`
   * Mac: `open -e .env`
3. Open the **Gita Mail** env file you downloaded from Netlify alongside it (check it says
   Gita Press, not Wheel King). Copy these values across, **exactly**, with no quotes or spaces:

| In .env | Take it from | Notes |
|---|---|---|
| `DATABASE_URL` | **Your** PostgreSQL, not Netlify | `postgres://postgres:YOUR_PASSWORD@localhost:5432/gitamail`. Change the password and port. In the password, write `@` as `%40`, `#` as `%23`, `:` as `%3A`, `/` as `%2F` |
| `JWT_SECRET`, `ENCRYPTION_KEY`, `INTERNAL_API_SECRET` | Netlify file | Must be identical if you will copy the cloud data (Step 6). For a fresh start with no cloud data, run `npm run local:keys` and paste what it prints |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Netlify file, or new | Your sign-in for the local app |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Netlify file | For Google sign-in and personal Gmail |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Netlify file, if it is there | Leave blank if the key was uploaded in Settings → Mailboxes |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Netlify file | Keep `AI_PROVIDER=anthropic` |
| `SMTP_…` or `RESEND_API_KEY`, `MAIL_FROM` | Netlify file, if set | For alert and report emails |
| `ORG_NAME`, `INTERNAL_DOMAINS` | Already filled | Gita Press, Gorakhpur and gitapress.org |
| `APP_URL`, `PORT` | Already filled | `http://localhost:8888` and `8888`. Do **not** use the Netlify address |

4. Save and close the file.

---

## Step 5. Allow Google sign-in on localhost (5 minutes, one time)

1. Go to **console.cloud.google.com** → the project used for Gita Mail → **APIs & Services → Credentials**.
2. Click the **OAuth 2.0 Client ID** whose ID matches `GOOGLE_CLIENT_ID`.
3. Under **Authorised JavaScript origins** add: `http://localhost:8888`
4. Under **Authorised redirect URIs** add: `http://localhost:8888/api/auth/google/callback`
5. Click **Save**. It can take a few minutes to take effect.

Leave the existing Netlify entries. The service account for booksales@, retailsales@, mumbai@ and
manager@ needs no change.

---

## Step 6. Check everything (1 minute, repeat until it says Ready)

```
npm run local:check
```

It checks Node.js, every setting, the PostgreSQL connection, the Claude key and Google settings.
**If the `gitamail` database does not exist, it creates it.** Each line says OK, WARN or FAIL, with
the fix. Correct `.env` and run it again until the last line says **Ready**.

---

## Step 7. Optional: bring across the cloud data (10 to 30 minutes)

Do this if you want everything already in the Netlify version: mail, analysis, drafts, customers,
templates, settings and users. Skip it for a clean start.

1. In Netlify, copy the **unpooled** database connection string (`NETLIFY_DATABASE_URL_UNPOOLED`).
2. Download it into a file:
   * Windows (change 17 to your PostgreSQL version):
     `& "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" "PASTE_UNPOOLED_STRING" -Fc --no-owner --no-acl -f cloud.dump`
   * Mac: `pg_dump "PASTE_UNPOOLED_STRING" -Fc --no-owner --no-acl -f cloud.dump`
3. Load it into your local database:
   * Windows: `& "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" -h localhost -U postgres -d gitamail --no-owner --no-acl --clean --if-exists cloud.dump`
   * Mac: `pg_restore -h localhost -U postgres -d gitamail --no-owner --no-acl --clean --if-exists cloud.dump`
   Enter your PostgreSQL password when asked. A few "does not exist, skipping" notices are normal.
4. If step 2 says **server version mismatch**, your PostgreSQL tools are older than the cloud
   database. Install the PostgreSQL 17 command-line tools, or skip this step and start clean.

---

## Step 8. Start Gita Mail

```
npm run local:start
```

The first start builds the web app (about a minute), then shows:

```
[local] database ready
[local] Gita Mail running at http://localhost:8888
```

Open **http://localhost:8888** in your browser and sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`,
or with Google. **Keep the terminal window open**: closing it stops Gita Mail. Next time, start it
faster without rebuilding:

```
npm run local
```

---

## Step 9. Confirm it is fully working (15 minutes)

Tick each one:

1. **Mailboxes:** **Settings → Mailboxes** lists booksales@, retailsales@, mumbai@ and manager@.
   * Fresh start: upload the Google service-account key (JSON) there and add the four addresses.
2. **Sync:** press **Sync now** on one mailbox. Within a few minutes the terminal shows `[worker] tick done`.
3. **Processing:** **Settings → System status** shows emails read and "Analysed by Claude" rising.
   No red banner about Claude.
4. **Email and drafts:** **Email** shows threads with categories; **Replies to send** shows drafts
   with yellow items.
5. **Send test:** reply to an email you sent yourself from a personal address; check it arrives in
   the same Gmail thread with the footer.
6. **Alerts:** if SMTP or Resend is set, Reports → send a test report to yourself.
7. **Your own Gmail:** sign out, then **Sign in with Google**. It should come back to localhost and
   connect your mailbox.

When all seven work, the local copy is complete.

---

## Step 10. Switch off the Netlify copy

Two copies reading the same mailboxes will both raise alerts and draft replies. Once Step 9 passes:

1. Netlify → the Gita Mail site → **Site configuration → Environment variables** → set
   `AI_PROVIDER` to `heuristic` and remove the service-account key, **or** delete the site after a
   final download of the database (Step 7).
2. Keep the Netlify env file somewhere safe as a backup of the keys.

---

## Step 11. Keep it running in the background (optional)

So it starts on its own and keeps running after you close the terminal:

```
npm install -g pm2
pm2 start npm --name gitamail -- run local
pm2 save
```

* Mac: then run `pm2 startup` and paste the command it prints, so it starts after a restart.
* Windows: `npm install -g pm2-windows-startup` then `pm2-startup install`.

Useful: `pm2 logs gitamail` (see activity), `pm2 restart gitamail` (after changing .env), `pm2 stop gitamail`.

Keep the computer awake: Windows Settings → Power → **Sleep: Never** when plugged in; Mac System
Settings → Energy → **Prevent automatic sleeping**.

---

## Step 12. Back up your data (weekly)

* Windows: `& "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" -h localhost -U postgres -d gitamail -Fc -f "gitamail-backup.dump"`
* Mac: `pg_dump -h localhost -U postgres -d gitamail -Fc -f gitamail-backup.dump`

Copy the file to another drive or cloud storage. Turn on disk encryption (BitLocker or FileVault),
because the database holds all the mail.

---

## Updating to a new version

1. Stop Gita Mail (Ctrl+C in the terminal, or `pm2 stop gitamail`).
2. Replace the folder's files with the new version, **keeping your `.env`**.
3. Run `npm ci`, then `npm run local:start` (or `pm2 restart gitamail`). Database changes are applied automatically.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| `node` is not recognised | Install Node.js 22 LTS and open a **new** terminal |
| `npm ci` fails with ERR! | Delete the `node_modules` folder and run `npm ci` again; check the internet connection |
| Check says `cannot reach localhost:5432` | PostgreSQL is not running, or uses another port: check Services (Windows) or Postgres.app (Mac) and the port in `DATABASE_URL` |
| Check says `wrong user or password` | Fix the password in `DATABASE_URL`; encode special characters (`@` → `%40`) |
| Check says `Claude key rejected` | Create a new key at console.anthropic.com, check credit, paste it with no spaces or quotes |
| Google says `redirect_uri_mismatch` | Step 5 not saved, or typed differently; wait 5 minutes after saving |
| Mailboxes show token or decrypt errors after Step 7 | `ENCRYPTION_KEY` differs from Netlify: copy the Netlify value exactly, or reconnect the mailboxes |
| Page shows "Web app not built" | Run `npm run local:start` once |
| `EADDRINUSE` port 8888 | Another program uses 8888: set `PORT=8899` and `APP_URL=http://localhost:8899` in `.env`, and add that address in Google Cloud |
| No new mail after an hour | The terminal or pm2 must be running and the computer awake; look for `[worker]` lines |
