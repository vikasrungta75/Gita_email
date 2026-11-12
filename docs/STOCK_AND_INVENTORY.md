# Stock, addresses, reasons for contacting and inventory

This guide covers four things:

* live Tally stock and Gita Press addresses in reply drafts
* why each reader contacted Gita Press, kept in the customer database
* the **Inventory → Stock and sales** section
* how to load stock files.

The same code runs in the hosted (Netlify) edition and the local Docker edition. Nothing extra needs to be set up: the new tables are created automatically on the next start or deploy (migration `011`).

## 1. Uploading stock

Open **Uploads** (in the menu under Inventory). Only managers and admins can upload. Section 5 below covers the other files on the same page: orders, Kalyan dispatch, the book list and the price list.

| Slot | File | Used as |
|---|---|---|
| Head office (Gorakhpur) | Tally *Stock Summary* with the sheets `MAIN STOCK`, `RETAIL STOCK`, `SEMI FINISHED` | Readers are offered **Main + Retail**. **Semi-finished** stock is shown to staff only. |
| Branches | Tally *Stock Summary* with one sheet per branch (BANGALORE, DELHI, …) | Each sheet is matched to its branch from the godown names, so spellings like CUTTUCK still work. |

The Excel files from Tally are used as they are; do not convert them to CSV.

* **Period.** The period comes from the line at the top of each sheet, for example `4-Nov-26 to 6-Nov-26`.
* **Every upload is kept.** For each location, the latest period is its current stock.
* **Uploading the same period again replaces the earlier figures** for the locations in the new file. A branch file can therefore also be split into two files for the same period.
* **Partial branch files.** If a branch file leaves out a branch, that branch keeps its last uploaded stock.
* **Wrong slot.** A file put in the wrong slot is refused with a message.
* **Negative stock.** A negative closing stock in Tally counts as zero. The upload lists how many rows had one.
* **A godown of another location on a branch sheet is ignored.** The real branch file lists some Bangalore stock on the Delhi and Kolkata sheets, Rishikesh stock on Haridwar's sheet and so on; those rows count for no branch, and the upload says how many were ignored.
* **History.** To load 12 months of history, pick all the monthly files at once in each slot: one HQ file and one branch file per month.
* **Nothing is lost.** The original Excel file of every upload is stored and can be downloaded again. **Remove** hides an upload from the figures and **Restore** brings it back. An upload replaced by a newer one for the same period is kept too. Only an admin can erase a removed upload for good.

### Hindi book titles

Hindi titles are now part of the book list (**Settings → Master data → Books**, section 6). The earlier separate Hindi-titles upload is replaced by it; titles already loaded were carried over.

## 2. Stock and addresses in reply drafts

For every email waiting on an answer, Gita Mail finds the books the reader names or quotes by code ("code 6", "कोड 1362") and gives the AI the live stock.

* **Locations.** The draft quotes Gorakhpur and the **branch nearest the reader**. The nearest branch comes from their city, PIN code or state, using the email or the customer record. Readers abroad get Gorakhpur only, because books are sent by post and abroad only from Gorakhpur.
* **Quantities.** Readers are told **exact quantities**.
* **Price.** The price quoted is the **highest batch price at that location**, taken from batches in stock first.
* **Unclear matches.** If several editions or languages match, the draft lists them with their codes and asks the reader which one they mean.
* **Staff view.** The conversation page shows a **Stock for books mentioned** card with every location, the semi-finished stock and which branch is nearest.

**Addresses.** When a reader asks for an address, shop or phone number:

* If they name a place, the draft gives that branch plus the head office.
* If they name no place, it gives the full list.

The addresses come from the official Gita Press branch list and are kept in **Settings → Addresses**:

* **Hindi first.** Each location shows its Hindi address (the official one) with the English beside it. Both can be edited, with the PIN code, phone numbers and emails.
* **English kept in step.** If the Hindi address is changed and the English is not, the English is flagged for checking. Until someone confirms it, replies follow the Hindi.
* **Corrections are saved separately.** A corrected field is marked "corrected", and **Official** puts a location back to the official list.
* **Emails.** Only `@gitapress.org` emails are given to readers; branch Gmail addresses are staff-only.
* **Used everywhere.** The same list is used when a reader asks for an address and under every reply, which shows the English and Hindi address.

Without an AI key, the rules engine adds the same stock lines and addresses to its draft as plain text.

## 3. Reasons for contacting (customer database)

Each thread gets one or more reasons. The customer record collects every reason that person has ever written about. The list started with 22 reasons and is now edited in **Settings → Reasons for contacting** (managers and admins):

* **Add, rename, describe, regroup and reorder.** A rename keeps the reason's history; the description tells the AI when to use it (at most 200 characters).
* **Keywords** (English or Hindi) let the free rules engine tag emails without the AI. English keywords match whole words; Hindi keywords match anywhere. When keywords are added, older analysed emails are checked for them in the background, at no AI cost; threads whose reasons a person set by hand are left alone.
* **Hide** takes a reason out of the AI's choices and the filters; old records keep it, marked "(hidden)". **Show again** brings it back.
* **Merge into…** moves every thread and customer from one reason to another, with no duplicates. A merge cannot be undone.
* **Kalyan, International order and Other** are always needed: they can be renamed and described, not hidden or merged away.
* **Re-check with AI for a date range** analyses the threads in that range again. It shows the number of threads first, because it uses AI credit.
* No reasons are given to internal, automated or supplier email for now.

## 4. Inventory → Stock and sales

**Estimated sales** are outwards from branch shops and from Gorakhpur Retail Dispatch. Outwards from Gorakhpur Main Stock and from branch godowns (any godown with "Godown" in its name, plus any you list in settings) are transfers, not sales. Each upload is counted in the month its period ends; overlapping uploads are never counted twice.

| Tab | What it shows |
|---|---|
| Overview | Stock and value by location; estimated sales by month and by branch; days of cover; titles running low |
| Stock status | Every title at a location: stock, semi-finished, price, sales, days of cover, status |
| Top sellers | Best sellers by location, language and period, with a trend and where each one sells |
| Replenishment | What to send to each branch, and whether Gorakhpur has enough |
| Range per branch | Books that sell at branches with a similar language mix but that this branch does not stock |
| Slow movers | Stock that will take more than three times the target cover to sell, with a suggested transfer to a branch that is short |
| Demand and cross-sell | Groups of customers to approach; books readers asked for; readers to tell that a book is back in stock |
| Uploads and settings | The two upload slots, the Hindi titles, the replenishment settings and the upload history |

**Replenishment rules:**

* A branch should hold **60 days** of sales.
* Getting books from Gorakhpur takes **21 days**.
* A title is flagged when its stock covers fewer days than the lead time. The suggested quantity tops it up to 60 days.
* Once 6 or more months are uploaded, seasonality from earlier months adjusts the figures.
* Both numbers can be changed overall or for each branch.
* Recommendations wait until a location has **at least 28 days** of sales data, because a few days of data would exaggerate one-off sales.

**Finding your way around:**

* **Sort.** Click any column heading to sort; click it again to reverse.
* **Filter by book.** Stock status, Top sellers, Replenishment, Range, Slow movers and Demand have a **book filter**. Type part of a title, a Hindi title or a code, then press Enter or click a book; add as many books as you like. On Top sellers this compares the chosen books side by side.
* **One book everywhere.** Click any book title to see that book at every location: stock, semi-finished, price, sales a month, days of cover and its monthly sales.
* **Status chips.** These filter Stock status in one click: running low, out of stock but selling, overstocked and no sales. Replenishment (by urgency) and Slow movers (transfer suggested, no sales) have the same kind of chips.
* **Links keep your filters.** The page address keeps the filters, so a filtered view can be bookmarked or sent to a colleague.
* **Headings stay in view.** Long tables keep their headings visible as you scroll.

Every table can be downloaded as Excel. Access: admins and managers upload; analysts, managers and admins see the section; viewers see stock only in drafts.

## 5. Uploads: orders, Kalyan dispatch, book list and price list

Everything is uploaded on the **Uploads** page. Each kind shows when it was last uploaded and when the next one is due; a late upload shows as overdue (stock 7 days, orders 4 days, Kalyan 31 days, editable at the bottom of the page).

| Slot | How often | File |
|---|---|---|
| Orders | twice a week | the Gita Press orders export, CSV or Excel: orderId, orderMongoId, siteCategory, customerName, email, phone, totalAmount, subtotal, postage, paymentMethod, orderStatusCode, orderStatusLabel, paymentStatus, createdAt, trackingId, deliveryPartner, shipFirstName, shipLastName, shipAddress1, shipAddress2, shipCity, shipPincode, shipMobile |
| Kalyan dispatch | every month | subperiod, custno, NAME, ADDRESS, city, pin, state, PhoneNo, DispMode, sbarcodeno, dispdate, Fromissue, Toissue, EmailID (Returnsts is kept in the stored file but not used yet) |
| Book list | when it changes | section 6 |
| Price list | when it changes | Code and Price (MRP) |

**Orders.** Each file holds all orders to date. Orders are matched by order number: a new number is added, a changed status or tracking number updates the order and is added to its history, and nothing is deleted. What the real export contains, and how Gita Mail handles it:

* **Exact copies.** Many orders appear twice; each is counted once.
* **Two numbering series.** Imported orders (`GPHO341633`) and online orders (`GPHO_341633`) are different orders even when the digits match, so the underscore is kept.
* **Damaged tracking numbers.** Excel turns long tracking numbers into `5.0E+12`; about one order in five in the October–November 2026 file. These are marked damaged, shown in amber and never put in a link. Export the file again with the tracking column as text to repair them.
* **Courier names.** Names written several ways (`www.delhivery.in`, `Delhivery.in`) are merged; unknown ones are listed after the upload and can be added in **Master data → Names and codes**.
* **No books per order.** The file has no book code or quantity, so customers are measured by orders and spend, never by books bought.

**Kalyan dispatch.** One row per dispatch; every row is kept (the key is subscriber number, issues and dispatch date, numbered when a subscriber has two identical rows). `1Y` is a 1-year subscription, `FY` (or `fy`) 5 years, `LM` life member. `Fromissue`/`Toissue` are issue numbers (one a month); a row such as 1 → 10 is a new subscriber receiving the earlier issues of the year. **Ordinary** post has no barcode and no tracking; **Registered** post always has a barcode, which is the dispatch and tracking number. A large file (the May–October 2026 file has 757,379 rows) is read on your own computer and sent in small parts: keep the page open until it says the rows have arrived (about half a minute), then the rest happens in the background.

**Is a month complete?** The table *Kalyan dispatch by month* warns when a month is well below the usual size or has no ordinary-post dispatches. In the May–October 2026 file, **August and November have registered post only**, so their ordinary-post dispatches look missing.

**Renewal (estimated).** Kalyan runs by calendar year. A 1-year subscription is due for renewal in January of the next year. A 5-year subscription's date is known only when a catch-up row shows the year it started; otherwise it shows "not known". Life members never renew.

**History.** Every upload of every kind is listed in one history with its original file, kept for at least five years, filterable by kind and date and downloadable to Excel or PDF. **Remove** takes out the rows only that upload brought in (the file is kept); only an admin can erase a removed upload for good. The email retention setting never touches uploads or the data they produced.

**Figures after each upload.** After every upload, and on a schedule (weekly on Monday at 6 am India time by default; **Settings → System status**), Gita Mail links people across email, orders and Kalyan, works out order and Kalyan figures and customer tiers, and raises important-buyer alerts. No AI is used. **Run now** starts it at once.

## 6. Master data (Settings → Master data)

* **Books.** One row per book code: Code, English name, Language, Hindi title, Other names (separate with ;), gitapress.org link, Amazon link, Title family and Status (Active, Needs details, Removed), plus optional category, price and print settings. Search by code, English name, Hindi title or other names; filter by language, missing link or Hindi title, needs details or removed; sort by any column; edit by clicking a row; add; remove (restorable); download to Excel or PDF. Upload the whole list on the Uploads page: a summary of what will change is shown before anything is saved.
  * Codes are text: `1` and `1.0` are the same book. `#N/A` means empty; the book is flagged and counted as a gap.
  * Hindi titles in the file carry the code (`श्री नारायणीयम्-639`): it is removed for display and matching; the original text is kept.
  * Links must be on gitapress.org or amazon.in/amazon.com; the sites are not called.
  * A code that first appears in a Tally file is added automatically, marked **Needs details**.
  * **Title family** groups the language editions of one work, filled in automatically from names that sound the same or share a Hindi title. A family typed by hand is never changed.
* **Addresses.** The branch list, moved here from its own tab.
* **Catalogues.** A file or link per category, with the words readers use for it.
* **Names and codes.** Courier names and tracking websites, state spellings, language names, order status codes and Kalyan codes.
* **Festival calendar.** Extra sales ahead of festivals, for the ship and print lists.
* **Customer tiers.** Points and the share of customers in each tier (section 7).

## 7. Customer database: orders, Kalyan and tiers

* **One customer per person.** People are linked automatically only on an exact, valid email address or an exact mobile number (last 10 digits). Where an email and a mobile point to two records, or two records have the same name and PIN code, they are listed under **Possible duplicates** for staff to join or keep apart; they are never joined automatically. **Split** moves orders or a Kalyan subscription to a new record.
* **New columns and filters:** tier, orders, spend, last order date, Kalyan (type and subscriber number). The record shows the order list (with tracking numbers) and the Kalyan dispatch history. The filters live in the page address, so a filtered list can be bookmarked.
* **Tiers.** Points for spend and orders in the last 12 months, years with Kalyan (a life member counts at least 4 years, a 5-year subscriber 2, a 1-year subscriber 1, at 0.5 points a year by default) and bulk or dealer buying. Customers are ranked: the top 2% are Platinum, the next 8% Gold, the next 20% Silver. A plain 1-year Kalyan subscription on its own stays Regular. On the October–November 2026 orders and the May–October Kalyan file this gives 500 Platinum and 1,999 Gold buyers.
* **Important buyers.** Emails from Platinum and Gold customers show the tier and come first in **Replies to send**. An alert is raised when a Platinum or Gold buyer has not ordered for 90 days (editable) and when a Kalyan subscriber of two or more years has not renewed.
* **Who sees what.** Phone numbers and postal addresses are for analysts and above; viewers see names only. Every download is written to the audit log.

## Notes

* **Request size.** Netlify accepts requests up to about 6 MB. A Tally export of about 2 MB uploads comfortably. If a future file is much larger, split it into two branch files for the same period, each with different branches.
* **Where to start.** The figures improve with history. Load the last 12 monthly files first, then upload the latest stock summary as often as you like.
