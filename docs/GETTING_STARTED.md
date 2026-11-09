# Getting started: Gita Mail on Netlify with Gmail and Gemini

Allow about an hour. The steps follow each other because each one needs a URL or key from the step before.

Throughout this guide the site is called **gitamail**, so its address is `https://gitamail.netlify.app`. If you choose another name, use your address wherever this one appears.

## Step 1. Gemini API key (2 minutes)

1. Open **https://aistudio.google.com/apikey** and sign in.
2. Select **Create API key** and pick (or create) a Google Cloud project.
3. Copy the key. It goes into Netlify as `GEMINI_API_KEY` in step 5.

Gita Mail uses **`gemini-3.8-flash`** by default for analysis and draft replies. Set `GEMINI_MODEL` to change it:
* `gemini-3.1-pro-preview` writes richer drafts.
* `gemini-3.5-flash-lite` is the cheapest.

## Step 2. Create the Netlify site (5 minutes)

1. In **https://app.netlify.com** select **Add new project → Import an existing project → GitHub**.
2. Choose **vikasrungta75/Gita_email**. The build settings come from `netlify.toml`; leave them as they are.
3. Select **Deploy**. The first build may fail because there is no database yet. That's expected.
4. Go to **Project configuration → Change project name** and enter `gitamail`.
5. Go to **Data & Storage → Database → Create a database**. Netlify links Postgres to the site automatically (`NETLIFY_DB_URL`).

## Step 3. Google Cloud: sign-in and Gmail access (15 minutes)

Do this with a **Gita Press Google Workspace administrator** account.

1. Open **https://console.cloud.google.com**. Create a project called `Gita Mail`, or use the one from step 1.
2. Go to **APIs & Services → Library**, search for **Gmail API**, and select **Enable**.
3. Go to **Google Auth Platform** (in older consoles, **OAuth consent screen**) and select **Get started**:
   * App name `Gita Mail`, support email your address.
   * Audience **Internal**. Only Gita Press accounts can sign in, and Google does not need to review the app.
   * Under **Data access → Add or remove scopes**, add these:
     * `openid`, `email`, `profile`
     * `https://www.googleapis.com/auth/gmail.readonly`
     * `https://www.googleapis.com/auth/gmail.send`
4. Go to **Clients → Create client**:
   * Type **Web application**, name `Gita Mail`.
   * **Authorised redirect URIs**, add both:
     * `https://gitamail.netlify.app/api/auth/google/callback`
     * `https://gitamail.netlify.app/api/connect/google/callback`
   * Select **Create** and copy the **Client ID** and **Client secret**.

## Step 4. Shared mailboxes such as orders@, kalyan@ and info@ (15 minutes, optional)

Each person's own inbox connects automatically when they sign in, so skip this step if that is all you need. For team mailboxes that nobody signs in to, a Workspace administrator gives Gita Mail access once:

1. In Google Cloud go to **IAM & Admin → Service accounts → Create service account**. Name it `gita-mail-mailboxes`, then select **Done**. No roles are needed.
2. Open the account, go to **Keys → Add key → Create new key → JSON**, and save the file. You will upload it in step 7.
   * If Google says key creation is disabled, an organisation administrator must allow it for this project. Go to **IAM & Admin → Organisation policies → Disable service account key creation → Override**, set it to **Off** for the `Gita Mail` project, create the key, then switch it back on.
3. On the service account's **Details** tab, copy the **Unique ID**. This is its client ID.
4. Open **https://admin.google.com → Security → Access and data control → API controls → Manage domain-wide delegation → Add new**:
   * Client ID: the Unique ID from point 3.
   * OAuth scopes: `https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.send`
   * Select **Authorise**. It can take a few minutes to start working.

Domain-wide delegation can reach any mailbox in the domain. Gita Mail reads only the mailboxes an admin adds in step 7, and records every addition in the audit log.

## Step 5. Environment variables in Netlify (5 minutes)

Go to **Project configuration → Environment variables → Add a variable** and add each of these. Generate the three secrets with `openssl rand -hex 32`, or with any password generator set to 64 letters and numbers.

| Key | Value |
| --- | --- |
| `GEMINI_API_KEY` | from step 1 |
| `AI_PROVIDER` | `gemini` |
| `GEMINI_MODEL` | `gemini-3.8-flash` |
| `GOOGLE_CLIENT_ID` | from step 3.4 |
| `GOOGLE_CLIENT_SECRET` | from step 3.4 |
| `GOOGLE_SSO_ALLOWED_DOMAINS` | `gitapress.org` (comma separated if there are several) |
| `JWT_SECRET` | random 64 characters |
| `ENCRYPTION_KEY` | random 64 characters (keep a copy; changing it disconnects mailboxes) |
| `INTERNAL_API_SECRET` | random 48 characters |
| `ADMIN_EMAIL` | the first administrator's Gita Press Google address |
| `ADMIN_PASSWORD` | a strong password (10+ characters, letters and numbers) |
| `ORG_NAME` | `Gita Press, Gorakhpur` |
| `INTERNAL_DOMAINS` | `gitapress.org` |

Defaults you can change: `SIGNIN_BACKFILL_DAYS` (90), `GOOGLE_SSO_DEFAULT_ROLE` (analyst), `GMAIL_SEND_ENABLED` (true), `DEMO_DATA_ENABLED` (false).

Don't paste the service account JSON into Netlify. Netlify functions allow only about 4 KB of variables in total, so the key is uploaded in the app in step 7 and stored encrypted.

## Step 6. Deploy and check (3 minutes)

1. Go to **Deploys → Trigger deploy → Deploy project** and wait for **Published**.
2. Open `https://gitamail.netlify.app/api/health`. Everything should show `"ok": true`. `google_workspace_shared_mailboxes` stays `false` until step 7.

## Step 7. Sign in and connect mail (5 minutes)

1. Open `https://gitamail.netlify.app` and select **Sign in with Google** with the `ADMIN_EMAIL` account.
2. Google asks once to allow Gita Mail to read and send email. Select **Allow**. Your inbox connects and the last 90 days start syncing.
3. **Shared mailboxes:** go to **Settings → Mailboxes**.
   * Select **Upload service account key** and choose the JSON file from step 4.
   * Select **Add mailbox**, type e.g. `orders@gitapress.org`, then select **Test access** and **Add mailbox**. Repeat for each team mailbox.
4. **Settings → Reply drafts:** add reference information the AI may use in replies, so fewer items are left in yellow. Examples: dispatch times, the Kalyan subscription fee, the bulk order process and refund timelines. Set the signature too.
5. Colleagues just open the site and select **Sign in with Google**. Their inbox connects automatically. Make supervisors **manager** in **Admin → Users** so they see the combined view.

### Using Claude instead of Gemini

Set these in Netlify, then redeploy. Nothing else changes: drafts, yellow items and Send work the same.

| Key | Value |
| --- | --- |
| `AI_PROVIDER` | `anthropic` |
| `ANTHROPIC_API_KEY` | from console.anthropic.com → API keys |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` (best drafts) or `claude-haiku-5-5` (faster, cheaper) |

Threads already analysed keep their analysis. New mail, and threads that fell back to the rules engine, are analysed by Claude. Use **Rewrite** on a draft, or **Re-analyse** on a thread, to redo one with Claude.

## Step 8. Templates and reference data (15 minutes, recommended)

Open **Help and templates** in the menu.

1. **Email categories** lists every group and subgroup. The category report under **Email → Category report** uses the same headings.
2. **Reply templates** has one default reply for each subgroup that needs an answer. Managers select **Edit** to change the wording; **Restore default** undoes it. `{{name}}`, `{{order_ref}}`, `{{book}}` and `{{signature}}` are filled in automatically, and `[[provide: …]]` becomes a yellow item.
3. **Reference data**: upload CSV files (Excel → Save as → CSV UTF-8):
   * Book catalogue: `code, title, language, price, in_stock, notes, keywords`
   * FAQs: `question, answer, keywords`
   * Policies: `title, text, keywords`

   Select **Sample file** to see the format, and **Try matching** to check which entries an email would bring in.

## Step 9. Using reply drafts

* **Replies to send** lists every email waiting on an answer, with a complete reply already drafted in the language the reader wrote in.
* Text in **yellow** is information the AI does not have, for example "confirm whether 5,000 copies can be supplied within 2 months (yes / no / partial)". Click it and type the answer. **Next** jumps to the next one.
* **Send** stays disabled until nothing yellow is left. When pressed, the reply goes from Gmail, from the mailbox the reader wrote to, as a reply in the same Gmail thread. It appears in that mailbox's Sent folder.
* **Save draft** keeps your edits in Gita Mail. **Rewrite** asks the AI for a fresh draft. **No reply needed** removes it from the list.
* If someone answers directly in Gmail instead, the draft disappears on the next sync.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `redirect_uri_mismatch` from Google | The redirect URIs in step 3.4 must match exactly: https, your site name, no trailing slash |
| "Your Google account is not set up for this workspace" | Add the domain to `GOOGLE_SSO_ALLOWED_DOMAINS`, or create the user in Admin → Users |
| Send says "does not allow sending yet" | The person signed in before sending was enabled: sign out and sign in with Google again |
| Shared mailbox Test access fails with "not authorised" | Check step 4.4: the client ID and both scopes, separated by a comma. Wait 5 to 10 minutes |
| Drafts show the model `remail-heuristic-v1` | `GEMINI_API_KEY` is missing or invalid. Check Logs → Functions for `[ai]` errors, then select Rewrite |
| Gemini `429` errors | Free-tier limit: set `AI_MIN_INTERVAL_MS=6000` or enable billing on the Google Cloud project |
