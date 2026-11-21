# Google Workspace setup (sign-in and mailboxes)

Do this once, with a **Gita Press Google Workspace administrator** account. It is the same for the desktop and the
cloud copy; only the redirect addresses differ.

## 1. Google Cloud: sign-in and Gmail access (15 minutes)

1. Open **https://console.cloud.google.com**. Create a project called `Gita Mail` (or use the project the cloud server runs in).
2. **APIs & Services → Library** → search **Gmail API** → **Enable**.
3. **Google Auth Platform** (older consoles: **OAuth consent screen**) → **Get started**:
   * App name `Gita Mail`, support email your address.
   * Audience **Internal**: only Gita Press accounts can sign in, and Google does not need to review the app.
   * **Data access → Add or remove scopes**: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/gmail.send`.
4. **Clients → Create client** → **Web application**, name `Gita Mail`. **Authorised redirect URIs**, add the ones you use:
   * Desktop: `http://localhost:8888/api/auth/google/callback` and `http://localhost:8888/api/connect/google/callback`
   * Cloud: `https://mail.gitapress.org/api/auth/google/callback` and `https://mail.gitapress.org/api/connect/google/callback` (your domain)
5. Copy the **Client ID** and **Client secret** into `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

## 2. Shared mailboxes (booksales@, manager@, retailsales@, mumbai@, kalyan@)

Team mailboxes that nobody signs in to are read through a service account with domain-wide delegation:

1. **IAM & Admin → Service accounts → Create service account**, name `gita-mail-mailboxes`, **Done** (no roles needed).
2. Open it → **Keys → Add key → Create new key → JSON** and save the file. If key creation is disabled, an organisation
   administrator overrides **Disable service account key creation** for this project, creates the key, and switches it back on.
3. Copy the service account's **Unique ID** (its client ID).
4. **https://admin.google.com → Security → Access and data control → API controls → Manage domain-wide delegation → Add new**:
   client ID from point 3, scopes `https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.send` → **Authorise**.
5. In Gita Mail: **Settings → Mailboxes → Upload service account key** (the JSON file), then **Add mailbox** for each address
   and **Test access**. The key is stored encrypted in the database; it is never put in git.

Gita Mail never modifies, labels, moves or deletes mail. It sends only when a person presses **Send** (with 30 seconds to
undo). Set `GMAIL_SEND_ENABLED=false` to switch sending off entirely.

| Scope | Why |
| --- | --- |
| `openid`, `email`, `profile` | Sign in with Google |
| `https://www.googleapis.com/auth/gmail.readonly` | Read mail and its attachments |
| `https://www.googleapis.com/auth/gmail.send` | Send a reply, only when a person presses Send |
