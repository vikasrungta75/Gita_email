# Stock, addresses, reasons for contacting and inventory

This guide covers four things:

* live Tally stock and Gita Press addresses in reply drafts
* why each reader contacted Gita Press, kept in the customer database
* the **Inventory → Stock and sales** section
* how to load stock files.

The same code runs in the hosted (Netlify) edition and the local Docker edition. Nothing extra needs to be set up: the new tables are created automatically on the next start or deploy (migration `011`).

## 1. Uploading stock

Open **Inventory → Stock and sales → Uploads and settings**. Only managers and admins can upload.

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
* **History.** To load 12 months of history, pick all the monthly files at once in each slot: one HQ file and one branch file per month.
* **Nothing is lost.** The original Excel file of every upload is stored and can be downloaded again. **Remove** hides an upload from the figures and **Restore** brings it back. An upload replaced by a newer one for the same period is kept too. Only an admin can erase a removed upload for good.

### Hindi book titles (optional)

Tally names are in English letters. Emails written in Devanagari are matched to them by sound, so "गीता साधक संजीवनी" finds *Gita Sadhak Sanjivani*. A list of Hindi titles makes this more reliable.

1. Click **Download list to fill in**. The file already contains every code and English name.
2. Fill in the **Hindi title** column. **Other names** is optional; separate several names with `;`.
3. Upload the file with **Upload Hindi titles**.

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

Each thread gets one or more reasons (purposes). The customer record collects every reason that person has ever written about. The reasons are:

* Kalyan
* Book order
* Book order tracking
* Availability / price enquiry
* International order
* Bulk order
* Dealer / bookseller enquiry
* Suggestion: book content / edits
* Suggestion: printing
* Voluntary service (seva)
* Complaint
* Payment / refund
* Translation / new-language request
* Permission to reprint / quote
* Scripture question
* Branch address / contact
* E-book / website / app
* Book fair / event
* Donation offer
* Visit / stay at Gita Bhawan
* Job enquiry
* Other

How reasons are set:

* **New mail.** The AI sets the reasons, and the rules engine adds the ones that follow from the subgroup.
* **Older threads.** These are filled in by the rules engine in the background, at no AI cost.
* **Corrections.** Staff can change the reasons on the conversation page (**Details → Reasons for contacting → Change**). A reason set by staff is never overwritten.

In **Admin → Customer database** click any column heading (Name, Type, Place, Country, Language, Reasons, Threads, Last contact) to sort; click again to reverse. You can filter by:

* **Contacted for** (any or all of several reasons)
* **Never contacted for**
* city, country, language, type and the other filters already there.

Download the filtered list as **Excel** or **CSV**; both include the reasons. Each customer's record also suggests books and offers for upsell and cross-sell.

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

## Notes

* **Request size.** Netlify accepts requests up to about 6 MB. A Tally export of about 2 MB uploads comfortably. If a future file is much larger, split it into two branch files for the same period, each with different branches.
* **Where to start.** The figures improve with history. Load the last 12 monthly files first, then upload the latest stock summary as often as you like.
