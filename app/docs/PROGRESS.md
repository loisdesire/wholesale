# Progress

Running record of what's done, what's outstanding, and the next concrete step. Update this as
work lands — see "How to work" in [VISION.md](VISION.md) Part 2.

## Done (2026-10-21)

Build order step 1 ("Repo setup, stack decision, auth, base data model + migrations") is complete:

- Next.js 16 + TypeScript + Tailwind v4 app scaffolded, Prisma 6 + SQLite configured, initial
  migration applied.
- Full Phase 1 data model in `prisma/schema.prisma`: Organization, User, Product, StockMovement,
  Customer, Conversation, Message, Order, OrderItem, AuditLog — tenant-scoped, ledger-based stock,
  integer-cents money, locked order-item prices.
- Realistic seed data (`prisma/seed.ts`): one org, two users (owner/staff), 20 SKUs across
  Ankara/lace/denim/footwear/accessories with opening stock, 4 customers, 4 conversations at
  different lifecycle stages, 3 orders (draft/confirmed/fulfilled) with real audit log entries.
- Auth.js (Credentials + JWT) wired to the User table; route protection in `src/proxy.ts`.
- Design system established (see CLAUDE.md "Design system") and applied to: login screen, app
  shell/nav, dashboard (needs-attention queue, order pipeline, recent orders, today's activity),
  and read-only list views for Inbox, Orders, Catalogue, Customers (Catalogue gained full CRUD in
  step 2, below — Inbox/Orders/Customers are still read-only pending steps 3–4).
- Verified end-to-end in a real browser: login with seeded credentials, all five screens render
  real data correctly, sign-out clears the session, middleware redirects unauthenticated requests
  to `/login` with the correct `callbackUrl`.
- `npm run build` passes clean (typecheck + build).

## Done (2026-10-21, continued)

Build order step 2 ("Catalogue CRUD + stock ledger — prove it can't oversell and every movement is
traceable") is complete:

- `src/lib/stock.ts`: transactional `recordStockMovement` — reads current stock and rejects atomically
  if a movement would drive it negative (`InsufficientStockError`), inside one `prisma.$transaction`.
  `DATABASE_URL` now carries `?connection_limit=1` so SQLite serializes writes and this is actually
  race-safe in dev, not just correct-looking. See the code comment in `stock.ts` for what to upgrade
  to (`Serializable` isolation or row locking) before relying on this under Postgres concurrency.
- `/catalogue/new` — create a product, with an opening-stock quantity recorded as its first ledger
  movement (never a column set directly).
- `/catalogue/[id]` — product detail: editable product fields, a manual stock-movement form
  (purchase received / customer return / damage / manual adjustment, in or out), and full movement
  history. SKU uniqueness is enforced and surfaced as a friendly form error (Prisma P2002).
- Catalogue list page now links through to product detail and has an empty state + "New product" CTA.
- **Automated test** (`tests/stock.test.ts`, run via `npm run test`): covers normal in/out movements,
  rejecting an over-large deduction with no row written, ledger-sum-equals-stock, and — the scenario
  VISION.md's testing discipline calls out by name — two concurrent fulfilment attempts against a
  product with exactly 1 unit left: exactly one succeeds, one is rejected, stock never goes negative.
  Tests run against a throwaway `prisma/test.db`, recreated fresh every run by
  `tests/global-setup.ts` — never the dev database.
- Verified the full create → record movement → reject-oversell → edit → list loop live in a browser
  (not just the automated test).
- `npm run build`, `npm run lint`, and `npm run test` all pass clean.

## Done (2026-10-21, continued further)

Build order step 3 ("Manual order creation flow, no AI — prove the lifecycle works by hand") is
complete:

- `src/lib/orders.ts`: the full lifecycle as one transactional domain module —
  `createDraftOrder` (locks item prices at the moment they're added, draft touches no stock),
  `confirmOrder` (reserves every line item's stock atomically in one transaction — all items
  succeed or none do, using the new `recordStockMovementTx` exported from `stock.ts` for exactly
  this purpose), `markOrderPaid`, `markOrderFulfilled`, `cancelOrder` (releases reserved stock if
  the order had been confirmed), plus `addOrderItem`/`removeOrderItem` for editing a still-draft
  order. Every transition writes an `AuditLog` row.
- Stock is decremented exactly once, at confirmation (`SALE_RESERVED`) — not again at fulfilment.
  This was a deliberate call: confirming is the real commitment point (vision's lifecycle goes
  "order acceptance → payment → inventory reservation"), decrementing earlier (at draft) would lock
  stock against a non-binding quote, and decrementing again at fulfilment would double-count.
  Cancelling a confirmed order reverses the reservation (`RESERVATION_RELEASED`); only DRAFT and
  CONFIRMED orders can be cancelled — once PAID, only forward progress to FULFILLED is allowed
  (matches Phase 1's literal "draft → confirm → paid → fulfilled" scope; a cancel-after-payment is
  a refund workflow, out of scope).
- `/orders/new`: pick an existing customer or create one inline, build a cart against live
  stock/price, create the draft.
- `/orders/[id]`: a lifecycle stepper (draft/confirmed/paid/fulfilled — a genuine sequence, so a
  numbered stepper earns its place here), status-appropriate action buttons, an items table
  (editable while draft, locked once confirmed), and full audit history.
- **Automated tests** (`tests/orders.test.ts`, 7 tests): price-locking survives a later catalogue
  price change, drafts don't touch stock, confirming is all-or-nothing across multiple line items
  (confirms a 2-item order where only one item is short — asserts *neither* item's stock moves),
  the full draft→confirmed→paid→fulfilled transition sequence, rejection of out-of-order
  transitions, reservation release on cancel, and refusal to cancel a fulfilled order.
- Verified live in a browser: created an order, confirmed it (watched stock drop on the catalogue
  page in real time), marked paid, marked fulfilled, confirmed the audit trail reads correctly;
  separately verified confirming against a 0-stock item fails with "Only 0 of X in stock, cannot
  remove 1" and leaves the order in DRAFT; verified cancelling a draft order works.
- `npm run build`, `npm run lint`, and `npm run test` (18 tests total) all pass clean.

## Done (2026-10-21, continued further still)

Build order step 4 ("WhatsApp Cloud API webhook ingestion — receive + store messages; reply
manually at first") is complete:

- `src/lib/whatsapp.ts`: `verifyWebhookSignature` (HMAC-SHA256 over the exact raw request bytes,
  timing-safe comparison — never re-serialized JSON, which would silently break verification for
  payloads that don't round-trip byte-for-byte), `parseWebhookPayload` (normalizes Meta's webhook
  shape into inbound messages; non-text message types get an honest `[unsupported message type: …]`
  placeholder rather than fabricated content; non-message changes like delivery-status updates are
  ignored), and `sendWhatsAppTextMessage` (throws on any failure rather than ever being treated as
  sent when it wasn't).
- `src/lib/inbox.ts`: `ingestInboundMessage` — finds or creates the customer and an open
  conversation, inserts the message, and is idempotent on `Message.externalId` (a Meta redelivery
  is caught as a unique-constraint violation and treated as a no-op, not a duplicate). A message
  into a resolved conversation reopens it to NEW (unless it's AI_HANDLING). `sendStaffReply` only
  writes the outbound Message row after the WhatsApp API call actually succeeds.
- `src/app/api/webhooks/whatsapp/route.ts`: GET handles Meta's one-time verification handshake;
  POST verifies the signature, parses, and ingests. Exempted from session-based route protection
  in `src/proxy.ts` (`api/webhooks` added to the matcher's negative lookahead) since Meta's calls
  carry no session — authenticity comes entirely from the signature check.
- `/inbox/[id]`: full conversation thread (inbound/outbound visually distinguished), linked
  orders, a "Create order for this customer" shortcut (prefills `/orders/new`), "Mark resolved",
  and a reply box that's disabled with a clear explanation when WhatsApp isn't configured, rather
  than pretending to work.
- **Automated tests** (`tests/whatsapp.test.ts`, `tests/inbox.test.ts`, `tests/webhook-route.test.ts`
  — 19 tests): signature accept/reject/tamper/missing-secret, payload parsing including the
  unsupported-type and ignored-change-type cases, ingestion idempotency and conversation
  reuse/reopening, and — importantly — the *real* exported route handlers exercised end to end
  with a correctly computed HMAC signature (not just the underlying functions in isolation),
  including a verified-redelivery-doesn't-duplicate case.
- Verified live: `curl` against the running dev server confirms the GET handshake and POST both
  correctly reject unauthenticated/unsigned requests over real HTTP (403 / 401); the inbox detail
  UI (thread rendering, linked order, mark-resolved) verified in a real browser.
- **Known limitation, clearly flagged rather than hidden:** there is no real Meta WhatsApp Business
  account or Anthropic-adjacent credential available in this environment, so the signature
  verification and ingestion logic are proven correct against synthetic-but-realistic signed
  payloads (see the tests above), not against Meta's actual infrastructure. Going live needs: a
  Meta app + WhatsApp Business account, `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`/
  `WHATSAPP_APP_SECRET`/`WHATSAPP_VERIFY_TOKEN` in `.env` (documented in `.env.example`), and the
  webhook URL registered in the Meta app dashboard pointing at a publicly reachable deployment
  (`/api/webhooks/whatsapp`) — none of which Claude Code can set up on your behalf.
- `npm run build`, `npm run lint`, and `npm run test` (28 tests total at the time) all pass clean.

## Done (2026-10-22)

Build order step 5 ("Wire in AI product-matching — propose only, never commit") is complete:

- `src/lib/ai/catalogue-search.ts`: deterministic (non-AI) catalogue search — exact-SKU and
  substring scoring across name/SKU/variant text. This is the *only* way the AI can learn what's
  in the catalogue; it never answers from memory or invents a match. Zero-stock products are
  still returned (never hidden), so the AI can see and communicate a shortage honestly.
- `src/lib/ai/engine.ts`: `runAIAssist` — a manual tool-use loop (not the SDK's beta Tool Runner;
  full control over iteration count and tool execution was simpler to reason about for this small
  a tool surface) against `claude-opus-5-5` with exactly two tools: `search_catalogue` and
  `create_draft_order` (which only ever creates a DRAFT — reuses the same `createDraftOrder` from
  step 3, so a drafted order is atomic, price-locked, and touches no stock, identically to a
  staff-created one). Capped at 4 tool-call rounds so a confused loop can't run away. The system
  prompt enforces VISION.md's Phase 1 AI job description directly: never invent products/prices/
  stock, ask a clarifying question on ambiguity instead of guessing, never claim an order is
  confirmed/paid/shipped.
- `/inbox/[id]` gained a "Let AI respond" action: runs the assist, and — matching the same
  never-claim-an-unconfirmed-action principle already used for the manual reply form — only
  records the reply as an outbound Message if the WhatsApp send actually succeeds. If it can't be
  sent (not configured here), the proposed reply text and any drafted order are still shown to
  staff, explicitly labeled "not sent," rather than silently discarded or falsely marked sent.
- **Automated tests**: `tests/catalogue-search.test.ts` (5 tests, pure logic — ranking, exact-SKU
  priority, zero-stock visibility) and `tests/ai-engine.test.ts` (4 tests, Anthropic client
  mocked so no real API calls are made — the mocked tool-call sequence exercises the *real*
  `createDraftOrder` against the test database, asserting the resulting order is genuinely a
  price-locked DRAFT row linked to the right conversation; also covers the ambiguous-request/
  clarifying-question path, the round-cap safety limit, and that `runAIAssist` throws immediately
  without any network call when `ANTHROPIC_API_KEY` is unset).
- Verified live in a browser: the inbox detail page's "AI assist" section correctly shows "AI
  product-matching isn't configured in this environment (missing ANTHROPIC_API_KEY)" rather than
  a broken or misleading control.
- **Known limitation, clearly flagged:** no `ANTHROPIC_API_KEY` is available in this environment,
  so the tool-calling logic is proven correct against a mocked client exercising the real
  database-backed tools (see above) — it has not been run against a live model. VISION.md asks
  for "basic sanity checks on product matching" at Phase 1, not a formal eval harness (explicitly
  deferred); once a key is available, point-check it against a few realistic/ambiguous/misspelled
  messages before trusting it with real customers, per VISION.md's testing discipline.
- `npm run build`, `npm run lint`, and `npm run test` (37 tests total) all pass clean.

## Done (2026-10-22, continued)

Build order step 6 ("Full draft → confirm → paid → fulfilled flow end to end") is complete — this
was mostly already proven by steps 3–5 individually; what step 6 adds is the proof that they
*compose*:

- `tests/end-to-end-flow.test.ts`: one test that runs the entire pipeline through real code paths
  — a real signed WhatsApp webhook POST creates the conversation, the AI engine (model mocked,
  everything else real) searches the real catalogue and drafts a real order from it, and that
  order is then taken through confirm → paid → fulfilled using the exact same lifecycle functions
  a manually-created order uses. Asserts stock is reserved exactly once at confirmation, the final
  order total and conversation link are correct, the stock ledger's `SALE_RESERVED` movement
  reconciles exactly with the confirmed quantity, and the audit log reads
  `ORDER_DRAFTED → ORDER_CONFIRMED → PAYMENT_MARKED_PAID → ORDER_FULFILLED` in order.
- The exception paths VISION.md calls out for this step were already exercised directly: stock-short
  at confirmation (`tests/orders.test.ts`, plus a live browser check in step 3 showing the exact
  "Only N in stock" message), and the all-or-nothing multi-item reservation case. "Price
  disagreement" isn't a separate flow in Phase 1 — a draft's items are editable (add/remove) and
  the whole order is cancellable right up to confirmation, which is the mechanism for it at this
  scope; a dedicated renegotiation workflow isn't in VISION.md's Phase 1 minimum scope.
- `npm run build`, `npm run lint`, and `npm run test` (38 tests total) all pass clean.

## Done (2026-10-22, Phase 1 build order complete)

Build order step 7 ("Dashboard polish") reviewed against the now-complete feature set:

- Re-walked every screen (dashboard, inbox list/detail, catalogue list/detail/new, orders
  list/detail/new, customers) live in a browser against freshly reseeded data — needs-attention
  queue, order pipeline counts, recent orders, and today's activity all read correctly; order
  detail's lifecycle stepper and audit history render real seed data (`PAYMENT_MARKED_PAID` /
  `ORDER_FULFILLED` audit actions translate to their human labels correctly, confirming the seed
  data's audit action strings still match what the real lifecycle code in `src/lib/orders.ts`
  writes). No changes needed — the dashboard was already built to the UI standard from Phase 1's
  first screen (per VISION.md's non-negotiable UI requirement), not a placeholder, and the richer
  feature set added in steps 2–6 (AI-handled conversations, webhook-ingested messages, order audit
  trails) slots into the existing design without needing new sections. Genuine dashboard iteration
  (e.g. operational-performance metrics, overdue-order highlighting) depends on real usage
  patterns that don't exist yet — exactly as flagged when step 1 shipped it.

**Phase 1 build order (VISION.md Part 2, steps 1–7) is now complete.** All 7 steps verified both
with automated tests (38 tests across 8 files, `npm run test`) and live in a real browser;
`npm run build` and `npm run lint` pass clean. See each "Done" section above for exactly what was
built and verified at each step, and "Known gaps / flagged decisions" below for what's genuinely
unverified (real WhatsApp/Anthropic credentials) versus deliberately out of scope (deferred items,
below).

VISION.md Phase 1's own definition of done — "real WhatsApp orders can run through this for two
weeks without reverting to spreadsheets, and at least one real ambiguous product-matching case has
been handled correctly or correctly escalated by the AI" — needs real usage with real credentials
that this environment doesn't have; that's the honest state to carry into the next session, not
something to claim as verified here.

## Done (2026-10-22, Phase 2 — Catalogue & inventory depth)

With Phase 1 complete, moved on to VISION.md Part 1's Phase 2 ("Catalogue & inventory": products/
variants, SKUs, stock movements, reservations, search, import/export, validation) — scoped to
exactly what was described when offered: CSV import/export, price tiers, MOQ, explicit units,
flexible variant attributes, and catalogue search that scales. **Deliberately not built**: the
physical/reserved/available/damaged stock split VISION.md describes for full Phase 2 — that's a
real rework of the already-tested order-lifecycle code (`src/lib/orders.ts`), bigger than what was
scoped in the offer, and better done as its own deliberate piece of work.

- **Schema**: `Product` gained `costCents` (nullable), `moq` (default 1), `unit` (default
  "piece"); new `PriceTier` model (quantity-break wholesale pricing). Migrated cleanly.
- `src/lib/pricing.ts`: `resolveUnitPriceCents` — picks the highest qualifying quantity-break
  tier, falling back to the base price. Wired into both order-creation paths server-side
  (`createDraftOrder`/`addOrderItem` in `src/lib/orders.ts`) so pricing is never trusted from the
  client, plus MOQ enforcement at the same two call sites.
- `src/lib/csv.ts`: CSV import (`parseProductsCsv` — preview/validate without writing, classifies
  each row as create/update/error; `commitProductsImport` — writes only non-error rows, records
  opening stock as a real `INITIAL_STOCK` ledger movement, never touches stock on an update row
  even if the file carries one) and export (`serializeProductsCsv`, round-trips losslessly).
  `/catalogue/import` is a two-step upload → preview → commit flow; `/api/catalogue/export` streams
  a CSV download. **Caught and fixed a real bug during testing**: duplicate-SKU detection only
  flagged the *second* occurrence of a repeated SKU, not the first — fixed to count occurrences
  up front and flag every row sharing a duplicated SKU.
- **Catalogue search rewritten to be database-backed** (`src/lib/ai/catalogue-search.ts`) instead
  of loading every active product into memory — the specific anti-pattern VISION.md calls out
  ("never the full catalogue loaded into AI context"). Pulls a bounded candidate pool from SQL
  (term matches on name/SKU, unioned with a capped recent-active-products pool so variant-only
  terms like a colour are still reachable — SQLite can't filter inside a JSON column cheaply),
  then does precise per-term AND matching on that bounded pool. **Caught and fixed a real bug
  during testing**: a query mixing a name term with a variant term (e.g. "lace gown gold") wasn't
  matching, because the SQL-match path and the variant-fallback path checked terms against
  different, non-combined text instead of one unified haystack.
- Catalogue list gained server-side search + pagination; product form generalized from fixed
  colour/size fields to arbitrary attribute rows (any key/value — material, model, packaging, …),
  plus cost/MOQ/unit fields and price-tier rows; order-creation UI (both the new-order cart and the
  order-detail add-item form) shows tier/MOQ hints and live-resolves the correct tiered price.
- AI engine's `search_catalogue` tool result now includes `moq` and `priceTiers`, and the system
  prompt was updated so the AI quotes the correct tiered price and respects MOQ when drafting.
- **Automated tests**: `tests/pricing.test.ts` (5), `tests/csv-import.test.ts` (6, including a
  round-trip-through-export-and-reimport case), `tests/catalogue-search.test.ts` rewritten for the
  new DB-backed signature (9, including an explicit "never returns an inactive product" and an
  org-scoping case), plus new MOQ/tier cases added to `tests/orders.test.ts`. 55 tests total.
- **Verified live in a browser** (DOM-level verification via accessibility tree + direct database
  checks, not visual screenshots — the Chrome extension's screenshot capture was hanging on `Page.
  captureScreenshot` for this whole session, on a brand-new tab too, so it's a local Chrome/GPU
  issue, not an app issue; DOM reads and all interactions worked throughout): created a product
  through the form with a custom attribute, cost, MOQ, and a price tier — confirmed byte-for-byte
  correct in the database. **Caught and fixed a real UI bug this way**: the variant-attribute
  key field starts pre-filled with the literal text "colour" (not a placeholder) as a convenience
  default; clicking in and typing without clearing first appends instead of replacing (produced
  `"colourcolour"` once). Fixed with select-on-focus, the standard pattern for pre-filled "smart
  default" fields. Also verified the full CSV import preview → commit flow with a real 3-row file
  (one create, one update, one deliberately invalid row) and confirmed the exact DB result; and
  verified a 15-unit order against a tiered product resolves and locks the correct tier price
  (₦17,000, not the ₦18,500 base) both in the live cart display and in the persisted order row.
- `npm run build`, `npm run lint`, and `npm run test` (55 tests, 10 files) all pass clean.

## Done (2026-10-23 — Postgres, stock figures, returns/refunds/balances)

Three pieces of work picked up from the "suggested next steps" list, done in order because each
changed the schema the next one builds on.

### 1. PostgreSQL (replaces SQLite)

- Provider switched; SQLite migrations replaced by one fresh Postgres baseline (nothing but seed data
  existed, so no data migration). `docker-compose.yml` runs Postgres 16 locally. `.env.example` is
  now actually committed — it never had been (`.gitignore`'s `.env*` swallowed it), so the
  first-time-setup steps in CLAUDE.md couldn't have worked from a clean checkout.
- **Found and fixed a real overselling race that SQLite had been hiding.** On Postgres' default
  READ COMMITTED isolation the old read-then-write stock check let 12 parallel reservations against
  3 units all succeed (10–11 got through). `recordStockMovementTx` now locks the product row
  (`SELECT … FOR UPDATE`) first; the stress test in `tests/stock.test.ts` failed before the lock and
  passes after. Multi-item operations lock in sorted product order (a concurrency test confirms
  opposite-order orders don't deadlock). The row lock also doubles as a tenant check: moving stock
  for another organization's product is refused.
- **Order references** came from `count()+1`, which collided under concurrent draft creation
  (the old code comment predicted this). Now an atomic counter on `Organization.orderSeq`.
- **Case-insensitive search**: Prisma's `contains` is case-sensitive on Postgres, silently
  regressing catalogue search and the AI's `search_catalogue`; both now pass `mode: "insensitive"`
  (verified in a browser: `?q=ankara` and `?q=ANKARA` both return the 5 matches).
- Test database is a separate Postgres DB (`TEST_DATABASE_URL`); setup refuses any name not ending
  `_test` because the suite wipes it.

### 2. Physical / reserved / available / damaged stock

- `StockMovement` now stores `physicalDelta` / `reservedDelta` / `damagedDelta` (replacing
  `quantityDelta`); available is derived. `src/lib/stock-effects.ts` maps every reason to its effects
  and validates sign. New reasons `RETURN_DAMAGED` and `DAMAGE_WRITTEN_OFF`; `DAMAGE` now means
  "set aside as damaged" (stays on hand, leaves availability) instead of "discarded".
- **Fulfilment now records the shipment** (physical and reserved drop; available unchanged) — before,
  fulfilling an order wrote no ledger movement, so reserved units would never have been released.
- Catalogue detail shows On hand / Reserved / Damaged / Available with per-figure history; the
  manual-movement form fixes the direction per reason; list and search show *available*.
- Migration backfills legacy rows and inserts the missing shipments for already-fulfilled orders.
  Written, then **tested on a legacy-shaped scratch database** — that caught a bug in the first
  draft (the backfill insert violated the old NOT NULL column). Available stock is preserved for
  every legacy case checked.
- Seed fix: confirmed order ORD-1003 now actually reserves its stock (it never had).

### 3. Returns, refunds and customer balances

- `src/lib/returns.ts`: request (fulfilled orders only; refund = quantity × the order line's
  *locked* price; cumulative returned quantity capped at what was ordered, race-safe) → owner
  approves/rejects → goods received (resellable back to available, damaged to the damaged figure) →
  owner records the refund as paid. **Owner-only steps are enforced in the domain layer**, not just
  hidden in the UI, per VISION.md's "refunds require human approval". Every step writes the order's
  audit history.
- `src/lib/balances.ts`: owes-us (confirmed unpaid), we-owe (approved refunds unpaid), cash received
  (paid less refunded), refunded — all summed from records on demand, never stored.
- UI: a Returns & refunds section on the order page (request form, per-state actions, role-aware),
  balance columns on `/customers`, a new `/customers/[id]` page (balance, order history, returns),
  and returns/refunds in the dashboard's needs-attention queue.
- **Tests**: 18 in `tests/returns.test.ts` and 13 in `tests/stock-figures.test.ts`, including
  concurrent cases (4 parallel return requests for the last units → one wins; 4 parallel "goods
  received" → stock added once; 3 parallel refund payouts → paid once). Verified these tests are
  meaningful by disabling the row locks: 3 of them fail.
- **Verified live in a browser** (Playwright, 16 checks, with screenshots — they work in this
  environment): staff see the return but no approve control; owner approves → receives → refunds;
  history lists all four events; the customer page nets ₦277,500 paid − ₦37,000 refunded = ₦240,500;
  a customer with a confirmed unpaid order shows ₦159,000 owed; stock figures on the product page.
- `npm run lint`, `npm run build`, `npm run test` (87 tests, 12 files) all pass clean.

## Done (2026-10-23, later — Phase 3: Orders & customers)

VISION.md Phase 3 is "customer records, order creation/items/pricing/lifecycle, search, history,
audit events". Returns/refunds/balances (above) were the first slice; this is the rest of what's
buildable without real payments or multi-tenancy.

### Customer records
- **Identity is the normalized phone** (`Customer.phoneKey`, `src/lib/phone.ts`). Found while
  scoping this: Meta's webhook sends `2348031234567`, staff type `0803 123 4567` or `+234…` — the
  old exact-string match would have created a *second customer* for the same person (splitting
  their orders, balance and conversations). Now all formats are one customer; creating one that
  already exists is refused with a link to the existing record; webhook ingest and manual creation
  are both race-safe (verified by firing 5–6 concurrent creates and checking for exactly one row).
- The migration backfills the key from existing phones and **refuses to run (with a clear error,
  changing nothing) if existing customers collide** — merging people is a human decision. Tested on
  a scratch DB with mixed formats and with a deliberate collision.
- Editable details (name/email/notes), delivery addresses (first is default; default is promoted if
  removed), activity history from the audit log, a new `/customers/new`, and a customer list with
  search (name/email/notes/phone in any format), balance filters ("Owes us", "We owe them") and
  pagination.
- **Possible-duplicate detection** (`findPossibleDuplicates`): flags the same line written with a
  different country code, the same email, or the same name — and says plainly that nothing is
  merged. A shared name alone is labelled a weak signal.
- **Agreed prices** per customer per product (owner-only). Resolution: agreed → tier → list. Applied
  on create / add-item / quantity change; existing orders keep their locked prices (tested, including
  after the agreement is changed or removed). The new-order form previews the agreed price.

### Order depth
- **Quantity change on a draft** re-prices the line (tier breaks, agreed prices, MOQ re-checked), is
  audited with before/after.
- **Delivery address + notes** on orders (prefilled from the customer's default address), editable
  until fulfilment, audited.
- **Cancelling a paid order** (owner-only): releases the reserved stock and records the refund owed
  (a `CANCELLATION`-kind refund that follows the normal pay-out step; there is no "goods received"
  step to wrongly restock). Balances treat it correctly: cash still held → refund owed → cash 0.
- **Repeat-order protection** (VISION's "repeated order request"): confirming an order identical to
  another live one from the same customer within 24h is refused unless a person explicitly overrides
  ("Confirm anyway — it's intended"); the override is recorded in the audit log.
- **Customer from another organization** could previously be attached to a new order — now rejected.

### Search
- Orders list: free-text search (reference, customer name/email/phone in any format, product
  name/SKU, notes, address), status chips, date range, pagination. Customers list likewise.
  New global `/search` across orders, customers, products and returns.
- **Bug found by a test:** Prisma's `contains` doesn't escape `%` and `_`, so typing `%` matched
  everything (also affected the existing catalogue search and the AI's `search_catalogue`). All
  user-typed search now goes through `ci()`/`escapeLike()`.

### Concurrency bugs found and fixed along the way
- **`loadOrderForUpdate` never actually locked.** Invisible on SQLite; on Postgres two simultaneous
  confirms both reserved stock, two simultaneous payments both recorded, two simultaneous cancels
  both refunded. Now takes a real row lock (`src/lib/locks.ts`); tests fail without it.

### Verification
- **Tests:** 147 across 15 files (`customers` 27, `order-depth` 19, `search` 14 new). Mutation-checked
  the important ones: removing the order lock fails the double-confirm/double-pay tests; replacing
  the race-safe customer insert fails the concurrent-ingest test.
- **Live in a browser (Playwright, 27 checks, screenshots)**: phone search in local format,
  duplicate-customer refusal, duplicate panel, notes edit + activity log, agreed price preview and
  order total, address prefill, quantity re-pricing, repeat-order warning and override button,
  paid → cancel-and-refund → refund recorded, customer balance, staff seeing no cancel-and-refund
  and no agreed-price form, global search by phone.
- `npm run lint`, `npm run build`, `npm run test` all pass clean.

## Known gaps / flagged decisions

- **Postgres is verified locally only.** Developed and tested against a local Postgres 16, not a
  managed/production instance — deployment, backups and connection pooling are still undecided.
  Note `Order.orderSeq`/`returnSeq` counters serialize order creation per organization on one row
  lock; fine at this volume, revisit if that ever becomes a hotspot.
- **No real WhatsApp or Anthropic credentials in this environment.** Webhook ingestion, reply
  sending, and AI product-matching are all built and tested against synthetic-but-realistic signed
  payloads and a mocked model client (see the step 4/5/6 "Done" sections) — correct by construction
  and by test, but not yet run against Meta's or Anthropic's actual infrastructure. Nothing in the
  app pretends otherwise: every screen shows a clear "not configured" state instead of failing
  silently or faking success.
- Vitest is configured (`npm run test`, 87 tests / 12 files). VISION.md's remaining testing-discipline
  scenarios not yet covered (a duplicate payment webhook — no payment gateway exists yet to have
  webhooks from, per "explicitly deferred"; a cross-tenant access attempt, which needs Phase 3's
  real tenant isolation to be meaningful) apply once their underlying features exist.
- **Returns/refunds scope limits (deliberate):** one refund per return, always the full value of the
  returned lines at their locked prices — no partial refunds, restocking fees or credit notes; no
  payment-gateway integration (the owner records that a refund was paid, by hand, like marking an
  order paid); a return is only possible after fulfilment (cancelling a paid-but-unfulfilled order is
  still out of scope). The balance is "orders vs refunds" only — there are no partial/instalment
  payments yet, so "owes us" means a whole confirmed order awaiting payment.
- **Phase 3 not done / deliberately left:** partial fulfilment (an order shipping in pieces) and
  partial refunds / credit notes; customer *merging* (duplicates are only surfaced); multi-tenant
  isolation enforcement (every query is org-scoped and tested for cross-org access, but there is no
  DB-level isolation or membership model); delivery-address validation (free text on purpose);
  order amendments after confirmation other than cancelling (a confirmed order can't have lines
  edited — cancel and redraft); a global search box in the header (it's a nav page).
- **`DAMAGE` meaning changed.** Pre-existing `DAMAGE` rows (which meant "written off") were converted
  to `MANUAL_ADJUSTMENT` with an explanatory note by the migration so history keeps its meaning.

## Suggested next steps (not started)

These are natural follow-ons, flagged here rather than started unprompted:

- Get real WhatsApp Business + Anthropic credentials into `.env` and do a live smoke test of
  webhook ingestion, reply sending, and AI product-matching against actual traffic. (Customer
  matching on the normalized phone matters most here — it's the first thing real traffic exercises.)
- Decide on and set up deployment (hosting, managed Postgres, env vars, running `prisma migrate
  deploy` in CI/CD).
- Phase 3 remainder: partial fulfilment + partial refunds, a safe customer-merge tool (explicit,
  previewed, reversible), real multi-tenant membership/isolation.
- Phase 4 (operations control room): operational metrics — return/refund rate, overdue orders,
  response times — now that there are real records to compute them from; assignment and queues.
- Phase 6 (payments & delivery): automated payment verification would let "mark paid" and "refund
  paid" rest on evidence instead of a manual click.
