# Where the app stands, the flows, and the requirements

Written 2026-11-25. Plain language first, technical terms explained.

---

## 1. Is this the MVP or the full, ready app?

**Short answer: it is more than an MVP in features, but it is not ready to launch to paying customers yet.**

- An **MVP** is the smallest version that proves the idea. This app already goes well past that: orders, stock ledger, returns and refunds, payments, a team inbox for WhatsApp and Telegram, an AI assistant that drafts replies, reports, per-business data isolation, billing screens, and an admin view for you as the platform owner.
- It is **not launch-ready** because the parts that touch the outside world have only been tested with *pretend* traffic, not real traffic, and some business decisions are still open.

| Area | Status |
| --- | --- |
| Orders, stock, customers, returns, refunds, reports, dashboard | **Built and tested** (395 automatic tests, 145 click-through checks) |
| Telegram bot + OpenAI AI replies | **Confirmed live** earlier with real conversations |
| WhatsApp | Built and tested with simulated messages. **Never run against real WhatsApp.** |
| Paystack payments and refunds | Built and tested with simulated payments. **Never run against a real Paystack account end to end.** |
| Email notifications (Resend) | Built, tested with a fake. **No real key yet.** |
| Hosting (where the app lives online) | **Not chosen.** It only runs on your computer. |
| Error tracking (Sentry) | Wired in, **no real project yet.** |
| Pricing and plan limits | **Placeholders.** Real numbers need conversations with real traders. |
| Sign-up for new businesses | **None.** A business is added by hand (see `PILOT_ONBOARDING.md`). |
| Delivery tracking | Staff type a carrier and tracking number. **No live tracking.** |
| Automatic push/SMS/email alerts | **Not built.** Alerts are inside the app only. |
| AI accuracy score | First real run: 10 of 13 test cases passed (77%; the bar is 80%). One run, 13 made-up cases. Needs tuning before you trust it unattended. |

**Honest label: "feature-complete pilot build".** Good enough to run with one or two friendly real businesses once hosting, real WhatsApp and real Paystack are connected. Not ready to sell openly.

**What stands between this and launch (in order):**
1. Pick hosting and put the app online.
2. Connect real WhatsApp, Paystack and Resend; test with real messages and a real small payment.
3. Improve the AI until it clears 80% on the test set, and decide how much the AI may do without a human.
4. Run a pilot with one real wholesaler; learn what they actually use.
5. Set real prices and limits; then add self-serve sign-up.

---

## 2. Flow checklist: the business owner (start to finish)

Tick these off when testing. "Staff" can do most daily steps; the owner also controls settings, billing and team.

**A. Getting started**
- [ ] Platform operator adds the business (manual step today)
- [ ] Owner signs in at `/login`
- [ ] Owner connects WhatsApp number and/or Telegram bot
- [ ] Owner adds staff accounts
- [ ] Owner sets response-time targets (`/operations/settings`)

**B. Setting up the shop**
- [ ] Add products with name, SKU, price, photo
- [ ] Add variants (size, colour) and quantity price tiers / minimum order
- [ ] Add opening stock
- [ ] Mark items inactive when not for sale
- [ ] Import or export the catalogue as CSV

**C. Customers**
- [ ] Customers appear automatically when they message in; or add one by hand
- [ ] Set a customer-specific price if needed
- [ ] Merge duplicate customers (never merged automatically)

**D. Handling a conversation**
- [ ] Open the inbox; see which chats need a reply
- [ ] Read the AI's suggested reply; edit and send, or reply yourself
- [ ] Reply goes out on the same channel the customer used
- [ ] Assign or escalate a chat; leave an internal note

**E. Turning a chat into an order**
- [ ] Create a draft order (customer, products, quantities)
- [ ] Price and stock are checked; total is shown
- [ ] Confirm the order → stock is reserved; price is locked
- [ ] Change a confirmed order if the customer changes their mind

**F. Getting paid**
- [ ] Generate a Paystack payment link and send it to the customer
- [ ] Payment is verified automatically, or mark it paid by hand (bank transfer)
- [ ] Order shows paid; unpaid orders show on the dashboard as money owed

**G. Delivering**
- [ ] Ship everything, or ship part and close the rest short
- [ ] Record carrier and tracking number
- [ ] Stock leaves the shelf; order becomes fulfilled

**H. When things go wrong**
- [ ] Customer returns items → request a return, receive it, restock or write off
- [ ] Refund recorded (by hand today)
- [ ] Cancel an order → reserved stock returns to the shelf

**I. Running the business**
- [ ] Dashboard: cash briefing, what needs attention, low stock, recent orders
- [ ] Operations page: late or stuck orders
- [ ] Reports: sales, stock, balances; save and download (CSV)
- [ ] Search across orders, customers, products
- [ ] Notifications: read, filter, mark read
- [ ] Billing: see plan, pay subscription

---

## 3. Flow checklist: the customer (start to finish)

**Important:** customers do **not** log in to this app. They only chat with the business on WhatsApp or Telegram, and open a payment link. There is no customer website, shop page or order-tracking page.

- [ ] Customer sends a message: "20 black two-piece, medium, how much?"
- [ ] The system finds the product (words, or a photo the customer sends)
- [ ] Customer gets a reply with real price and stock (from AI draft approved by staff, or sent by staff)
- [ ] If unclear, they are asked a question (colour? size?), never guessed for
- [ ] Customer agrees to the itemised order
- [ ] Business confirms the order; customer is told the total and reference (e.g. ORD-1004)
- [ ] Customer receives a Paystack payment link, or pays by bank transfer
- [ ] Payment is confirmed by the business (or automatically by Paystack)
- [ ] Goods are packed and shipped; customer is told carrier and tracking number
- [ ] Customer receives the goods
- [ ] If something is wrong: customer messages; business raises a return; refund follows
- [ ] Customer messages again later; history is already there

**Gaps from the customer's side:** no way to check order status themselves; no automatic "your order shipped" message (staff send it); no customer login or reorder button.

---

## 4. Functional requirements (what the app must DO)

**FR1 Access and teams**
- FR1.1 Users sign in with email and password.
- FR1.2 Each business has an Owner and Staff; owner-only actions are restricted.
- FR1.3 Each business sees only its own data.
- FR1.4 The platform operator sees every business overview (read-only, no customer or order data).

**FR2 Catalogue and stock**
- FR2.1 Products with variants, photos, price tiers, minimum order quantity, active or inactive.
- FR2.2 Stock is a ledger: every change has a reason, time and reference. Physical, reserved and available stock are separate.
- FR2.3 The app must never oversell, even if two orders arrive at once.
- FR2.4 CSV import and export.
- FR2.5 Only JPEG, PNG, WebP or GIF photos are accepted.

**FR3 Customers**
- FR3.1 Customers are created from incoming chats or by hand.
- FR3.2 Custom prices per customer; balances owed.
- FR3.3 Duplicates can be merged by a person, never automatically.

**FR4 Conversations**
- FR4.1 One inbox for WhatsApp and Telegram, showing channel, history, status and waiting time.
- FR4.2 Incoming messages are verified as genuine and de-duplicated.
- FR4.3 Replies go back on the original channel; delivery status is shown.
- FR4.4 Photos sent by customers are stored and shown.
- FR4.5 Staff can assign, escalate and add internal notes.

**FR5 AI assistant**
- FR5.1 Drafts replies using only real catalogue, price and stock data.
- FR5.2 Asks when unsure; never invents products, prices, stock, discounts or payment status.
- FR5.3 Can propose a draft order; a human confirms it.
- FR5.4 Can read a customer's photo to help find the product.
- FR5.5 Measured by a built-in test set (target 80% or better).

**FR6 Orders**
- FR6.1 Draft → Confirmed → Paid → Fulfilled, with cancellation.
- FR6.2 Confirming reserves stock and locks prices.
- FR6.3 Confirmed orders can be amended.
- FR6.4 Partial shipping is supported.
- FR6.5 Every order has a history of who did what, and when.

**FR7 Payments**
- FR7.1 Create a Paystack payment link per order.
- FR7.2 Payments are confirmed from Paystack's own signal, never from a customer's word or screenshot.
- FR7.3 A repeated payment signal must not record the payment twice.
- FR7.4 Payments can be recorded by hand (bank transfer).
- FR7.5 Reconciliation compares recorded payments to Paystack's.

**FR8 Returns and refunds**
- FR8.1 Return only goods that were actually shipped.
- FR8.2 Returned stock goes back to the shelf or is written off.
- FR8.3 Full and partial refunds; refund can be started through Paystack.

**FR9 Oversight**
- FR9.1 Dashboard: cash briefing, needs-attention queue, pipeline, stock risk, payment reminders.
- FR9.2 Late and stuck orders flagged against response-time targets the business sets.
- FR9.3 Reports with date ranges, saved views and CSV download.
- FR9.4 Search across orders, customers, products.
- FR9.5 In-app notifications.

**FR10 Billing and platform**
- FR10.1 Plans, trial, subscription payment, platform admin can extend a trial or unstick a payment.

---

## 5. Non-functional requirements (how well it must do it)

| Area | Requirement | Where we are |
| --- | --- | --- |
| **Security** | Known vulnerabilities in the software patched; audit clean | Done (0 found) |
| | Passwords never stored in plain form | Done |
| | Each business's data walled off at database level | Done and tested |
| | Webhooks verified; uploads restricted; secure-connection header | Done |
| | Secrets never in code or git | Done (`.env` is ignored) |
| **Accuracy** | Money, stock and order status come from the database, never from AI | Done by design |
| **Reliability** | Duplicate messages or payments must not double-count | Done and tested |
| | Third-party failures must show a clear message, not crash | Done ("not configured" states) |
| **Auditability** | Every important action recorded with who, what, when | Done |
| **Performance** | Pages open fast on normal mobile data; lists paginated | Partly checked only on a local PC. Not load-tested |
| **Usability** | Works on phone and desktop; short clear copy; large readable text | Done and checked at 390px and 1366px |
| **Accessibility** | Keyboard use, visible focus, readable contrast | Partly: not formally audited |
| **Maintainability** | Automatic tests, type checks and lint on every change | 395 tests, CI configured |
| **Scalability** | Target about 20 to 150+ orders a day per business | Designed for it; not load-tested |
| **Availability** | Backups and monitoring plan | **Written, not yet set up** (`MONITORING_AND_BACKUPS.md`) |
| **Deployability** | Repeatable deploy to a real host | **Not done**; no host chosen |
| **Compliance** | Handling of customer personal data (Nigeria's data-protection rules) | **Not reviewed** |

**Biggest non-functional gaps:** no hosting or backups, no load testing, no formal accessibility or data-protection review.
