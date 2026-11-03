# Gita Mail by Ravity

AI email intelligence for **Gita Press, Gorakhpur**, built on Gmail and Google Workspace, with Gemini doing the analysis and writing draft replies.

Gita Mail reads the Gita Press mailboxes (each person's own inbox, plus shared ones such as orders@, kalyan@ and info@). It rebuilds every thread, removes duplicates and analyses each conversation in Hindi or English. For every email waiting on an answer it writes a **complete draft reply** that stays in the app until someone presses **Send**. Anything the AI cannot know is highlighted in yellow for the team to fill in first.

## Features

**Gmail and Google Workspace**
* Sign in with Google; the person's own inbox connects automatically.
* Shared mailboxes through Workspace domain-wide delegation, limited to the addresses an admin adds.
* 90-day history on first connection, then incremental sync every 5 minutes (Gmail history API).
* Duplicates across mailboxes removed by Message-ID and content fingerprint.

**Reply drafts**
* A complete, courteous reply for every email waiting on an answer, in the reader's own language.
* Facts the AI cannot know become yellow `[[provide: …]]` items, for example whether 5,000 Gitas can be supplied in 2 months.
* Send is blocked until every yellow item is filled in.
* Send goes through Gmail, from the mailbox the reader wrote to, as a reply in the same thread.
* Reference information and a signature set in Settings make drafts more complete.
* Edits are kept, and drafts disappear when someone replies directly in Gmail.

**Groups, subgroups and default replies**
* Every thread gets a group (heading) and a subgroup (subheading), for example Kalyan subscriptions → Issue not received. 13 groups, 52 subgroups.
* A default reply template for each of the 45 subgroups that normally need an answer. Claude follows it, translates it for Hindi letters and fills in what it can.
* Help and templates: how it works, the full category list, the templates (managers can edit or restore them) and reference data.
* Reference data: upload the book catalogue, FAQs and policies as CSV. Matching entries are given to Claude for each email, so prices, stock and rules are filled in instead of left yellow.
* Category report (Email → Category report): groups as headings and subgroups as subheadings, with threads, waiting replies, negative and red threads, drafts and first-reply time. Print or download as CSV.
* Threads analysed before subgroups existed are sorted by the rules engine in the background, with no AI cost.

**Analysis built for Gita Press**
* Email types:
  * reader and customer service
  * book orders and e-books
  * Kalyan subscriptions
  * dispatch, VPP and delivery
  * bulk orders, distributors and quotes
  * publications, translations and editorial
  * payments, refunds and accounts
  * printing, paper and suppliers
  * careers and staff
  * internal, events and media, automated
* Issue types:
  * delivery delay, order not received
  * damaged or misprinted book, wrong item
  * payment deducted, refund
  * Kalyan subscription, address change
  * VPP tracking, website or app problems
  * bulk orders, language and edition requests
  * scripture questions, escalation
* Hindi and English understood; summaries in English.
* Red, amber and green rating with the reason, priority, escalation risk, and reader and customer health.

**Everything from remail**
* My day, Overview, Email by category, Readers and customers, Bulk orders and quotes pipeline.
* Actions and commitments, Alerts with escalation, Trends, Team performance, scheduled Reports, Mail Sage.
* Roles (admin, manager, analyst, viewer) with My view and Management view.
* Audit log, PII redaction before AI, encrypted tokens.

## Stack

* **Frontend:** React 18, Vite, TanStack Query, ApexCharts. Gita Press theme: maroon, saffron and cream, Noto Sans and Noto Sans Devanagari.
* **Backend:** Netlify Functions v2 (TypeScript).
  * `api`: the REST API
  * `scheduler`: runs every 5 minutes
  * `worker-background`: sync and analysis
* **Database:** PostgreSQL (Netlify Database or Neon). Migrations run automatically.
* **AI:** Anthropic Claude (`AI_PROVIDER=anthropic`, prompt caching on) or Google Gemini, with structured output. A rules engine tuned for Gita Press is the fallback; without the AI it drafts from the default templates.

## Set up

**[docs/GETTING_STARTED.md](docs/GETTING_STARTED.md)** goes step by step through:
* Gemini
* Netlify
* Google Cloud
* Workspace delegation
* sign-in
* reply drafts

## Run on your own computer (local edition)

Run everything (web app, database, mail reading) on one computer with Docker or Node.js, using the same `.env` as Netlify. Step-by-step guide: [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md).

```
docker compose up -d --build     # then open http://localhost:8888
```

## Run locally for development

```bash
npm install
cp .env.example .env    # DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY, ADMIN_EMAIL, ADMIN_PASSWORD, GOOGLE_*, GEMINI_API_KEY
set -a; source .env; set +a
npm run migrate
DEMO_DATA_ENABLED=true npm run seed   # optional Gita Press demo data
npm run dev:api                      # API on :8888
npm run dev                          # app on :5173
npm test                             # pipeline tests (empty test database)
```
