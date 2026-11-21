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
* **Dashboard**, for **All customers** or **Current year customers** and any year:
  * Current year: active (with the change on the year before), new, renewed, came back, lost, retention, payments in the
    last month; readers each year (new, renewed, came back, and lost below the line); retention by year; payments by
    month against the same month a year earlier; subscription mix by year; the year by subscription and dispatch mode.
  * All customers: total, live and inactive, life members, 5-year and 1-year, registered this year, outside India, balance
    due; registrations by year; length of membership; dispatch mode; why customers are inactive.
  * Definitions: *new* = first year ever; *renewed* = also active the year before; *came back* = not the year before but
    earlier; *lost* = active the year before, not this year; *retention* = renewed ÷ active the year before.
* **Geo spread**: India by state for All customers (customers, registered in a year, life members, inactive %) or Current
  year customers (active, new, renewed, lost, growth on the year before, retention). The year slider and **Play** step
  through the years. Select a state on the map or in the ranked list (with the change on the year before) to see its
  trend by year, top cities and top PIN areas, and **Open the customers**. Customers outside India are listed by country.
  The state comes from the PIN code where there is one. Jammu & Kashmir and Ladakh are one shape on the map; the hover
  shows each. State outlines: DataMeet, CC BY 2.5 India.
* Select any figure or row to open the customer list behind it; download any list as Excel or CSV.

## Full-data tables (Stock, Tracking, Book list, Book links)

Every **All data** view is the same table: search; select a column heading to sort (again to reverse); a filter on any
column (the values with counts) and **Ranges** for numbers and dates; **Columns** to show or hide columns; totals of the
number columns; **Excel** and **CSV** download exactly what is filtered. The filters are part of the address, so a view
can be bookmarked or shared, and dashboards open it already filtered.

## Stock

**Branch stock** and **Main, retail and semi-finished (Gorakhpur)**, each with:
* **Dashboard**: titles and copies in stock, stock value, copies out in the period, stock date; stock by branch (and a map
  of branch stock by state) or main / retail / semi-finished; books moving most; books that may run out (less stock than
  went out in the period); best sellers with no stock at Gorakhpur (with copies being made); by language and size;
  Suchi titles not in stock and codes in stock but not in the Suchi.
* **All data**: the latest stock of every location, one row per godown and book.
* **Upload and history**: the Tally Stock Summary; a check summary first; every upload and its original file.

**All stock uploads** lists every stock upload.

## Tracking

**Book orders** and **Kalyan tracking**, each with:
* **Book orders dashboard** (last 7, 30, 90 days, a year or all): orders, order value, average order, buyers and repeat
  buyers, orders not marked delivered and how long ago they were placed, damaged tracking numbers; orders by day, week or
  month; a map of orders (or value) by state from the delivery PIN code; top states and cities; status, delivery partner,
  payment, site, order value and day of the week.
* **Kalyan tracking dashboard**: dispatches, readers, share sent by registered post, the latest issue, readers in the
  previous issue not (yet) in the latest; dispatches by issue and by day (registered and ordinary); a map of readers (or
  registered %) by state; states, cities and subscriptions.
* **All data** and **Upload and history** as for stock. Each upload shows a check summary and is applied only when you
  select **Confirm**. Replies always use the latest data.

## Master data

Locations · Others (delivery partners and tracking sites, Kalyan subscription types and prices, dispatch modes, order
statuses, state spellings) · Bank details (admin only, audited) with the payment QR · Discount details · Freight charges ·
Book list (Suchi: the PDF or the Excel version; check summary first) · Book links (gitapress.org and Amazon) · Books
(combined): one row per code with both, editable; a price or size edited here is kept when the next Suchi is uploaded.

**Book list (Suchi)** and **Book links** each have a **Dashboard**, **All data** and **Upload and history**:
* Suchi: titles, sets, best sellers, typical price, titles in and out of stock at Gorakhpur, titles with an online link;
  by size, language, price, pages and set; best sellers with no stock.
* Book links: gitapress.org and Amazon coverage, books with no link, by language; best sellers with no online link. The
  links open from the table.

## Settings

* **Emails**: sync window (30/60/90 days) and interval; criticality and reply targets; the facts each group needs; which
  reason belongs to which group; the Kalyan year start; the Kalyan columns kept.
* **Pending questions**: completeness by group, the weekly completeness trend, open questions by type, answer once for
  all emails, and the standing answers with how many emails each completed.
* **Auto-send**: coming later; it cannot be switched on in this version.
* **System status → Delete everything and rebuild** (admin): backs up, deletes emails, replies, customers, stock and
  tracking uploads and the book list and links, keeps master data, rules, standing answers, templates, users and
  settings, and reads the mailboxes again.
