# Build audit and plan: orders, Kalyan, book master, replies, planning (November 2026)

The build follows the final prompt in the Gita Press Email project (`Prompt_Gita_Mail_FINAL_merged.md`): an audit first (this document), then three stages, each in its own pull request.

## What already existed (pull requests #1–#3)

| Area | Where | State |
|---|---|---|
| Tally stock uploads (HQ and branches), history, soft delete, original files | `server/stock/stock.ts`, `stock_uploads`, `stock_files` | Working; reused as is |
| Stock and addresses in reply drafts, nearest branch | `server/stock/stock.ts`, `server/directory.ts` | Working; Stage 2 changes the wording (availability only) |
| Inventory: sales estimated from outwards, replenishment, range, slow movers, demand, cross-sell | `server/stock/inventory.ts` | Working; Stage 3 adds print and ship lists |
| 22 reasons for contacting, fixed in code | `server/ai/purposes.ts` | Made editable in Stage 1 |
| Customer database (built from email) | `server/profiles.ts`, `CustomerDb.tsx` | Extended in Stage 1 |
| Hindi titles upload | `book_titles` | Replaced by the book master in Stage 1 |
| Scheduler and background worker | `netlify/functions/scheduler.mts`, `server/worker.ts` | Reused for uploads and the analytics run |

## Stage 1 (this pull request)

* Book master in Settings → Master data, replacing the Hindi-titles upload (`book_titles` extended, migration 013).
* One Uploads page: stock, orders, Kalyan dispatch, book list, price list; one five-year history.
* Orders and Kalyan tables, read in the browser and sent in parts, processed in the background.
* One customer per person across email, orders and Kalyan; tiers; review list; split; important-buyer alerts.
* Editable reasons for contacting (Appendix A).
* Analytics run after every upload and on a schedule.
* Stock rules from the decisions: a godown of another location on a branch sheet is ignored; Delhi's three godowns are transfers; every estimated sales figure carries the estimate note.

## Findings from the real files that changed the plan

1. **Order numbers.** The prompt said to match `GPHO341633` and `GPHO_341633` as one order. In the October–November 2026 file all 243 such pairs are **different orders** (different customers, amounts and phones): imported and online orders are two numbering series. The underscore is kept.
2. **Kalyan renewal.** "First issue seen" made 94% of subscribers look like new starts, because many were simply missing from the thin May file. Kalyan runs by calendar year (new subscribers get a catch-up row from issue 1), so: 1-year renewal is January of the next year; 5-year is known only from a catch-up row; life members never.
3. **Tiers.** About 100,000 plain 1-year Kalyan records swamp a percentile ranking: every book buyer became Platinum. A plain 1-year subscription on its own stays Regular; the 2/8/20% shares apply to the rest (500 Platinum, 1,999 Gold on the real data).
4. **Duplicate book codes.** A repeated code with blank cells would have wiped the first row's Hindi title and links; rows are now combined.
5. **Branch sheets** list other locations' godowns (Bangalore stock on Delhi and Kolkata, Rishikesh on Haridwar, Raipur and Kanpur on Patna): ignored, per decision 11.

Results on the real files (local test, not committed): book list 1,931 codes in 0.4 s; orders 5,122 rows → 3,258 orders (1,864 copies, 612 damaged tracking numbers); Kalyan 757,379 rows sent in 25 s and processed in 19 s; linking, figures and tiers 25 s; August and November flagged for missing ordinary post.

## Still to come

* **Stage 2:** order and Kalyan status replies with India Post and courier tracking, where-to-buy links, availability-only stock lines, catalogues, branch CC, address list PDF, signature with WhatsApp numbers, Gaps.
* **Stage 3:** print and ship lists, the 60-day Actions list, Orders and Kalyan dashboards, weekly summary email; also the `SalesSource` interface, overlap and date-spreading rules for estimated sales.
* **Stage 4 (on request):** bulk email, auto-send, real sales file, order line items, Kalyan return status.

## To discuss (left as built)

Stock lines when no AI key is set; the removed "Latest contact" sort and "India and abroad" filter; Settings tab layout; delivery by pull request; email-text retention.

## Risks

* The Kalyan file is 64 MB: the browser needs about 400 MB of memory while reading it. Older office computers may need the file split by month.
* Hosted edition: each part of an upload is a separate request under the 6 MB limit; the background function works through up to 13 minutes per call and carries on from where it stopped.
* Damaged tracking numbers can only be repaired by exporting the orders file again with the tracking column as text.
* Editions: the hosted edition is the target. The local Docker edition runs the same server and screens, so it gets everything in this pull request with no extra work (uploads are worked through in the same process instead of the background function). Nothing was built for it alone.
