# Gita Mail by Ravity

Email replies for **Gita Press, Gorakhpur**: complete, accurate answers from the Gita Press mailboxes
(booksales@, manager@, retailsales@, mumbai@, kalyan@), built on Gmail and Google Workspace.

For every email that needs a reply, Gita Mail:
* sorts it into one of six groups (**Book order issues**, **Kalyan**, **New order — bulk**, **New order — retail**,
  **International orders**, **Others**) with sub-tags, the 22 reasons for contacting, and a **criticality**
  (Critical / High / Medium / Low, rising with waiting time against a reply target);
* looks up every fact a complete reply needs in the latest uploads and master data — orders and tracking, Kalyan
  dispatches and customers, stock at Gorakhpur and the nearest branch, the book list (Suchi) price, discount, postage,
  bank details with the UPI QR, buy links — and shows the **completeness**;
* drafts the reply in the reader's language with found facts **green** and missing ones **yellow**, and asks a
  **specific question** for each missing fact (answer it on the email, or once for every email as a standing answer);
* lets you **Rewrite properly** (AI, every figure kept, side by side), **Send** (30 seconds to undo) or **Send later**.
  Nothing is ever sent automatically.

Bulk orders get a **quote builder**: prices from the Suchi, discount slabs, postage slabs and bank details, as a
bilingual PDF attached to the reply.

## Sections

| Section | What it holds |
| --- | --- |
| **Emails** | Outlook-style list and reading pane (right, below or off); tabs for All, the six groups, Bulk orders and quotes, Open questions, Not for reply; search, filters and sorting on every column, saved views, keyboard shortcuts |
| **Customer database** | Kalyan customers only, uploaded only: all customers (the complete file), current-year customers, a dashboard for each (new, renewed, came back, lost, retention, payments, subscriptions, tenure) and **Geo spread**: an India map by state with a year slider, state trends, cities and PIN areas; Excel/CSV downloads |
| **Stock** | Branch stock and Gorakhpur main/retail/semi-finished: a dashboard, all the data (search, filter and sort any column, download), and uploads with a check summary and history |
| **Tracking** | Book orders and Kalyan dispatches: dashboards (with maps by state), all the data, and uploads with a check summary and history |
| **Admin → Master data** | Locations, Others (delivery partners, Kalyan subscription types and dispatch modes, order statuses), bank details, discount, freight, book list (Suchi PDF or Excel), book links, books (combined) |
| **Settings** | Emails (sync window, criticality and SLA, completeness facts, reason → group, Kalyan year), Pending questions (summary and weekly trend), Auto-send (coming later; cannot be switched on), Mailboxes, Users, System status (including Delete everything and rebuild), Audit log |
| **To decide** | My day and Mail Sage, kept as they were |

See **[docs/USER_GUIDE.md](docs/USER_GUIDE.md)**.

## Install

* **Windows desktop** (own PostgreSQL): **[docs/INSTALL_LOCAL_WINDOWS.md](docs/INSTALL_LOCAL_WINDOWS.md)** — `deploy\windows\install.ps1`
* **Google Cloud** (one VM, self-managed PostgreSQL, nginx, HTTPS, nightly backups to Cloud Storage):
  **[docs/INSTALL_CLOUD_GCP.md](docs/INSTALL_CLOUD_GCP.md)** — `deploy/gcp/create-vm.sh`
* Google sign-in and shared mailboxes: **[docs/GOOGLE_WORKSPACE_SETUP.md](docs/GOOGLE_WORKSPACE_SETUP.md)**

Both run the same program: `npm run build` then `npm start` (`server/main.ts`: web app, API, mail sync, analysis,
uploads and the send queue in one Node.js process). Settings come from `.env` ([.env.example](.env.example)).

## Develop

```bash
npm ci
cp .env.example .env         # DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY (npm run keys), ADMIN_EMAIL, ADMIN_PASSWORD
npm run migrate
npm run dev:api              # API and worker on :8888
npm run dev                  # web app on :5173
npm test                     # needs DATABASE_URL to an empty test database
npm run typecheck
```

## Stack

React 18, Vite, TanStack Query, ApexCharts and Leaflet (India state outlines: DataMeet, CC BY 2.5 India); Node.js 22 with TypeScript (tsx); PostgreSQL 16 (migrations run on
start); pdfkit with Noto Sans Devanagari for quotes; pdf.js (and poppler's pdftotext when installed) for the Suchi PDF.
AI (optional): Anthropic Claude or Google Gemini for analysis and Rewrite; without a key the rules engine does
everything else.
