# Gita Mail user guide

## Emails

**Tabs.** All · Book order issues · Kalyan · New order — bulk · New order — retail · International orders · Others ·
Bulk orders and quotes · Open questions · Not for reply. The number on a tab is how many emails still need a reply.

**The list.** Criticality, sender, subject, group and sub-tag, mailbox, completeness, reply status, received and waiting
time. Select a heading to sort (again to reverse). Filters: reply status (Ready to send, Pending information, Sending,
Sent), criticality, sub-tag, mailbox, completeness, with attachments. Search finds senders, subjects, the email text,
order numbers, Kalyan customer numbers and book codes. Save the current filters as a **saved view** (bookmark icon).
The same email sent to two mailboxes appears once, with both mailboxes.

**Reading pane.** Right, below or off (the three buttons; remembered for you). Keyboard: `j`/`k` or arrows to move,
`Enter` to open, `/` to search, `Esc` to close.

**On each email:**
1. **Questions** at the top: one for each fact Gita Mail could not find, for example "Order not found — type the order
   number", "Price of code 1234", "International shipping cost to this country". Type the answer and select **Add
   answers to the reply**. Tick **for all emails** to keep the answer as a *standing answer*: every email with the same
   question is completed with it. Order numbers, Kalyan numbers, book codes (`6 x 10, 1388 x 2`) and places are looked up
   again when typed.
2. **The original email** and its **attachments** (open in a new tab).
3. **Facts**: green chips found, yellow chips missing.
4. **The reply**: found facts green, missing ones yellow. **Edit text** to change it by hand. **Rewrite properly** (needs
   an AI key) rewrites it cleanly in the reader's language; you see both side by side and choose. **Send** is possible
   when nothing is yellow: it waits 30 seconds with **Undo**, then sends from the mailbox the email came to, in the same
   thread. **Send later** picks a date and time (it can be cancelled until then).

Change the group, sub-tag or criticality from the drop-downs at the top: your choice is kept. **Not for reply** moves an
email out of the way (automated, internal and supplier mail go there by themselves).

**What replies contain.**
* Order issues: order number, date, amount, status, delivery partner, tracking number and the partner's tracking site.
* Kalyan: customer number, subscription, last dispatch (issues, date, mode), registered post number with the India Post
  link or "ordinary post has no tracking number"; membership status, last payment and receipt from the current-year file.
* New orders: each book's availability and count at Gorakhpur (and the nearest branch when the reader's place is known),
  price from the Suchi, buy links (retail), book value, discount (bulk only), postage, total, bank details.
* International: availability at Gorakhpur, price, international shipping, bank details with SWIFT.

**Criticality.** Each group or sub-tag starts at a level (Settings → Emails); waiting longer than the reply target
(working days) makes it High, longer than twice the target Critical. Money taken but books not received is Critical.

## Bulk orders and quotes

Every New order — bulk email has a request with a **stage**: Request received → In preparation → Quote sent →
Confirmed → Payment received → Dispatched → Closed. The tab lists them with search, stage filters and sorting.
In the email, the **quote builder** takes book codes (or a set code such as CB003) and quantities — or **Read codes for
the quote** from an attached Excel, CSV or PDF order list — and shows prices, discount, postage and total.
**Make quote PDF and attach** creates a bilingual quotation with the bank details and payment QR, attaches it to the reply
and moves the request to In preparation; sending the reply moves it to Quote sent.

## Customer database (Kalyan)

* **All customers**: upload the complete customer file (CustNo …). Only the useful columns are kept (Settings → Emails).
* **Current year customers**: upload the current-year file (Duration, No, Name, Address, Location, State, Country, Post
  code, then receipt number and payment date). The year comes from the latest payment date; change it before confirming.
* Uploads only add and update; net new customers in a current-year upload are added to all customers too.
* **Dashboard**: total, active this year, new, renewed, lost, payments by month, by subscription, dispatch mode, state
  and city. Select a figure to open its list; download any list as Excel or CSV.

## Stock and tracking

Upload Book orders, Branch stock, Main/retail/semi-finished stock and Kalyan tracking in their tabs. Each upload shows a
**check summary** (rows, new and known, dates, problems, comparison with the previous upload) and is applied only when
you select **Confirm**. Replies always use the latest upload; every upload and its original file are kept. **All data**
lists every upload; the table icon browses its rows.

## Master data

Locations · Others (delivery partners and tracking sites, Kalyan subscription types and prices, dispatch modes, order
statuses, state spellings) · Bank details (admin only, audited) with the payment QR · Discount details · Freight charges ·
Book list (Suchi: the PDF or the Excel version; check summary first) · Book links (gitapress.org and Amazon) · Books
(combined): one row per code with both, editable; a price or size edited here is kept when the next Suchi is uploaded.

## Settings

* **Emails**: sync window (30/60/90 days) and interval; criticality and reply targets; the facts each group needs; which
  reason belongs to which group; the Kalyan year start; the Kalyan columns kept.
* **Pending questions**: completeness by group, the weekly completeness trend, open questions by type, answer once for
  all emails, and the standing answers with how many emails each completed.
* **Auto-send**: coming later; it cannot be switched on in this version.
* **System status → Delete everything and rebuild** (admin): backs up, deletes emails, replies, customers, stock and
  tracking uploads and the book list and links, keeps master data, rules, standing answers, templates, users and
  settings, and reads the mailboxes again.
