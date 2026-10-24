# Adaeze Wholesale — order operations platform

Full product vision and the Phase 1 brief: [docs/VISION.md](docs/VISION.md). Read it before making
any architectural decision — Part 2 defines what's in scope right now, Part 1 is the destination
the foundation should grow toward. Keep [docs/PROGRESS.md](docs/PROGRESS.md) current as work lands.

## Stack and why

- **Next.js 16 (App Router) + TypeScript**, single deployable app — frontend, auth, and data access
  together, matches the "modular, not microservices" guidance in VISION.md for this stage.
- **Prisma + PostgreSQL** (`docker compose up -d db` for local dev; see `.env.example`). Moved off
  SQLite because SQLite's single writer had been *hiding* a real overselling race — see "Stock
  figures" below. Money is integer cents rather than `Decimal` (a choice that predates the move and
  keeps arithmetic simple). Postgres-specific behaviour to remember: Prisma's `contains` is
  case-sensitive here (unlike SQLite) — user-facing text search must pass `mode: "insensitive"`.
- Pinned to **Prisma 6**, not 7 — Prisma 7 requires driver adapters, which adds setup complexity
  with no benefit at this stage.
- **Auth.js (next-auth v5)**, Credentials provider, JWT sessions — no separate Account/Session
  tables needed. Route protection is in `src/proxy.ts` (Next 16 renamed the `middleware.ts`
  convention to `proxy.ts`; same API).
- **Tailwind v4**, hand-rolled components — see "Design system" below, not shadcn/ui.
- `cacheComponents` and `devIndicators` are off in `next.config.ts`: every page here is
  session-scoped, tenant-specific, and must always be fresh, so Next 16's static-by-default cache
  model fights more than it helps; the dev route badge was also colliding with the nav's
  bottom-left sign-out control.

## Data model conventions (do not deviate casually)

- Every tenant-owned table carries `organizationId`, even though only one org exists right now —
  this is load-bearing for Phase 3 multi-tenancy per VISION.md. All queries must filter by the
  signed-in user's `organizationId` from the session; there is no DB-level tenant isolation yet.
- **Tenant isolation is enforced by Postgres row-level security — read `docs/ISOLATION.md`.**
  Tenant data is reached ONLY through `tenantDb(organizationId)` (single queries) or
  `transaction(organizationId, fn)` (interactive transactions) from `src/lib/db.ts`; they set the
  `app.organization_id` the RLS policies check. The bare `prisma` export is the root client for
  identity tables only (`User`, `Membership`, `Organization`) — through it a tenant table looks empty.
  `tests/isolation.test.ts` scans `src/` and fails if `prisma.<tenant model>` appears. Helpers that
  take a `client` (`recordAudit`, `getStockBreakdown`, `getReturnableQuantities`, …) have no default
  on purpose: pass the tenant client or a transaction. **A new table needs `organizationId` + an RLS
  migration** (the coverage test fails until it has one).
- **The app connects as `wholesale_app`** (`DATABASE_URL`), a role with no superuser/BYPASSRLS —
  those skip RLS silently. Migrations and the seed use `DIRECT_URL` (the owner). The test suite runs
  application queries as the restricted role (`TENANT_DATABASE_URL`) and fixtures as the owner.
  `npm run db:check-isolation` verifies the connection; production startup refuses to run without it.
- **Users belong to organizations through `Membership`** (role per organization). The session's
  organization + role are re-read from it on every request; never trust them from the token.
- **WhatsApp webhooks route by `Organization.whatsappPhoneNumberId`**, never "the first organization".
- **Outbound WhatsApp delivery status** (`Message.deliveryStatus`/`deliveryStatusAt`/
  `deliveryError`, `src/lib/message-status.ts`'s `applyMessageStatus`): Meta's status webhooks
  (`parseStatusUpdates` in `src/lib/whatsapp.ts`) are matched back to the `Message` by
  `externalId` and applied rank-ordered (sent < delivered < read; failed is terminal and always
  wins) — a redelivered or reordered webhook can never regress a message from "read" back to
  "delivered". `null` means "no status webhook received yet," never an assumed/guessed state.
- **Forms use `useSubmitAction`** (`src/lib/use-submit-action.ts`), not `useActionState` + `<form
  action>`: React 19 clears every uncontrolled input after a failed submit, and a retry then submits
  blanks. If you put your own `onSubmit` on such a form, call `formProps.onSubmit(e)` from it.
- **Stock is a ledger.** `StockMovement` rows are the only source of truth for inventory. Never add
  an editable quantity column to `Product`.
- **Stock figures** — each movement stores `physicalDelta` / `reservedDelta` / `damagedDelta`;
  `available = physical - reserved - damaged` is derived. `src/lib/stock-effects.ts` is the single
  table mapping each `StockMovementReason` to its effects (read its comment for the sign convention
  of `quantityDelta`). Confirming an order *reserves* (available drops), fulfilling it *ships*
  (physical and reserved drop), returns put units back as resellable or damaged. Customers can only
  be promised `available`.
- **Every stock write goes through `recordStockMovementTx`**, which locks the product row
  (`SELECT … FOR UPDATE`) before reading the ledger. Without that lock Postgres' READ COMMITTED lets
  parallel requests all see "3 left" and all succeed (the stress test in `tests/stock.test.ts`
  sold 3 units 10–11 times). Multi-product transactions must lock in a stable order
  (`sortByProductId`) to avoid deadlocks. Same pattern for returns: `lockRow` in `src/lib/returns.ts`.
- **Order/return references** come from atomic counters on `Organization` (`orderSeq`, `returnSeq`),
  not `count()+1` (which collided under concurrent creation).
- **Returns & refunds** (`src/lib/returns.ts`): only FULFILLED orders; refund amount is fixed at
  request time from the order lines' *locked* prices; cumulative returned quantity can never exceed
  what was ordered. **Only an OWNER can approve/reject a return or record a refund paid** (VISION.md:
  refunds need human approval) — enforced in the domain function, not just hidden in the UI. Goods
  arriving writes real ledger movements (`RETURN` resellable / `RETURN_DAMAGED`).
- **Customer identity is the normalized phone** (`Customer.phoneKey`, digits only, built by
  `phoneKeyOf` in `src/lib/phone.ts`; unique per organization). `phone` is only for display. Never
  look a customer up or create one by the raw string — "0803…", "+234 803…" and WhatsApp's
  "234803…" are one person. Create via `createCustomer` (refuses duplicates, points at the existing
  record) or `findOrCreateCustomerByPhoneTx` (race-safe, used by webhook ingest). **Duplicates are
  only ever surfaced** (`findPossibleDuplicates`) — nothing merges automatically, and a shared name
  alone is labelled a weak signal.
- **Agreed prices** (`CustomerPrice`): per-customer, per-product; resolution order is agreed price →
  quantity tier → list price (`resolveUnitPriceCents`). Owner-only to set/remove, enforced in
  `src/lib/customers.ts`. They apply to new orders and draft re-quantifying; existing orders keep
  their locked prices.
- **Locks.** `loadOrderForUpdate` genuinely locks the order row (`src/lib/locks.ts`). It used to
  only *read* it, which on Postgres let two simultaneous confirms both reserve stock and two
  simultaneous cancels both refund. Any new state-transition function should go through it.
- **Cancelling a paid order** is owner-only and creates a `CANCELLATION`-kind `OrderReturn` (status
  RECEIVED so the restocking "goods received" step can't run; refund PENDING). Balances count that
  cash as paid, then subtract it when the refund is paid out. Fulfilled orders can't be cancelled —
  they go through a return.
- **Repeat-order guard:** `confirmOrder` refuses an order that duplicates another live one (same
  customer, identical items and quantities, within 24h) unless `allowDuplicate` is passed — the UI
  only passes it from an explicit "Confirm anyway" button, and the audit entry records it. Tests that
  deliberately create identical orders must pass `allowDuplicate: true`.
- **User-typed search text goes through `ci()` / `escapeLike()`** (`src/lib/search.ts`): Prisma's
  `contains` doesn't escape `%`/`_`, so a bare "%" would match everything.
- **Shipments** (`Shipment`/`ShipmentItem`, `src/lib/orders.ts`'s `shipOrderItems`): an order can
  ship in pieces; each dispatch moves its own units out of physical+reserved together. An order is
  `PARTIALLY_FULFILLED` until everything has shipped. Returns are limited to what has *shipped*
  (`getReturnableQuantities` sums `ShipmentItem`, not `OrderItem.quantity`) — the unshipped
  remainder of a part-shipped order can't be "returned", it goes through `closeOrderShort`
  (owner-only: releases the reservation, creates an `UNSHIPPED`-kind refund for its value).
- **Amending a CONFIRMED (unpaid) order** (`amendConfirmedOrder`): a deliberate exception to "agreed
  terms lock at confirmation" — requires a reason, re-prices only the lines that actually changed
  (untouched lines keep their locked price), and re-reserves stock by the net difference,
  all-or-nothing. Once PAID, the amount is settled — cancel instead.
- **Partial refunds**: `OrderReturn.valueCents` is the goods' value at locked prices;
  `refundCents` is what the owner actually approved (may be less, with a required reason). Default
  (no `refundCents` passed to `decideReturn`) is the full value.
- **Customer merge** (`src/lib/customer-merge.ts`, owner-only): `previewMerge` → `mergeCustomers` →
  optionally `undoMerge`. Never deletes — the losing record is marked `mergedIntoId` and hidden from
  lists/search/duplicate-detection, never overwrites the kept record's existing name/email/notes,
  and a price conflict is won by the kept record (the loser's price stays on the archived record,
  not discarded). `resolveSurvivor` follows the merge chain, so a message from a merged-away number
  (and `createCustomer` on that number) resolves to wherever it currently points — call it, never
  look a customer up by id/phone and assume the row you get is the live one if it might be archived.
- **Assignment** (`src/lib/assignment.ts`): orders/returns/conversations can be assigned. An owner
  may assign anyone; staff may only move work between "unassigned" and "assigned to themselves" —
  never touch an assignment currently held by somebody else, in either direction
  (`permissionProblem` checks the *current* assignee, not just the requested new one — a staff
  member assigning *to themselves* is not automatically allowed if someone else already holds it).
  Bulk assignment (`bulkAssignOrders`) always previews (`dryRun: true`) before applying; each order
  succeeds or is refused independently, never partially-applies without saying which.
- **Notifications** (`src/lib/notifications.ts`): `notify()` is idempotent per `(userId,
  dedupeKey)` — build the key from the triggering event's id, not a timestamp, so a retried job
  can't double-notify. Client code that must run an effect exactly once (e.g. `MarkReadOnView`)
  should key the effect on a value derived from its real dependency, not a `useRef` "have I fired"
  guard — see the Gotchas section below for why that broke silently. Reading/marking your own
  notifications goes through `userScopedDb(organizationId, userId)` (`src/lib/db.ts`), not
  `tenantDb` — `Notification` is isolated to its *recipient* by row-level security too (a second
  `app.user_id` setting, same fails-closed shape as `app.organization_id`), not just an app-level
  `where userId`. Writing a notification *for* someone else (`notify()`) still uses the ordinary
  `transaction()`, since the actor isn't the recipient. See `docs/ISOLATION.md`.
- **Email is a second, best-effort channel layered on the in-app one** (`src/lib/email.ts`,
  `isEmailConfigured()`/`sendEmail()`, same "degrades gracefully, never fakes a send" shape as
  `whatsapp.ts`). `notify()` emails every targeted recipient only when `createMany`'s inserted
  count equals the recipient count — i.e. every one of them was genuinely new this call, never on
  a retry (which inserts none) or a partial overlap (treated the same as a retry, to never risk a
  second email for someone already told). A failed or unconfigured send is caught and logged, never
  thrown past `notify()` — the in-app notification is the source of truth and must not be undone by
  an optional channel failing.
- **Operations thresholds are per-organization** (`src/lib/ops-config.ts`'s `DEFAULT_SLA` +
  `resolveSla()`, `Organization.slaOverrides`, `src/lib/sla-settings.ts`, owner-only,
  `/operations/settings`): the needs-attention queue (`src/lib/operations.ts`), the dashboard and
  the metrics all call `resolveSla()` (never read `DEFAULT_SLA`/`SLA` directly) so "overdue" means
  the same thing everywhere for a given organization, even after that organization tunes it. A
  record that trips several rules appears once with every reason, not once per rule. Each rule is
  capped (`PER_RULE_CAP`) so the query stays bounded; `getAttentionItems` returns `{ items,
  truncated }`, not a bare array — the Operations page shows a banner when `truncated` is true
  rather than silently presenting a partial list as if it were complete.
- **Reports never call anything profit without cost data** (`src/lib/reports.ts`): margin is `null`
  unless at least one sold line's product has `costCents` set, and when it is present the report
  states what share of the period's revenue it actually covers — never silently treats a missing
  cost as zero. CSV export quote-prefixes any cell starting with `= + - @` (`csvSafe`/`toCsv`) so a
  customer/product name typed by someone else can't run as a formula when opened in a spreadsheet.
- **Customer balances are computed, never stored** (`src/lib/balances.ts`): owes-us = CONFIRMED
  unpaid orders; we-owe = approved-unpaid refunds; cash received = paid orders minus refunds paid.
  Revenue/cash/receivables stay separate — never label any of it profit.
- **Money is integer cents** (`priceCents`, `totalCents`, `unitPriceCents`), never float/Decimal.
- **Order item prices lock at creation** (`OrderItem.unitPriceCents`) and are never recalculated
  from a later `Product.priceCents` change.
- `AuditLog` exists from day one; use it for consequential state changes (payment marked, order
  confirmed, fulfilled, etc.) as those flows get built. Stock movements don't also get an
  `AuditLog` row — the `StockMovement` row itself already carries reason/actor/timestamp/note, so
  a duplicate entry would just restate the same fact.
- **Pricing is resolved server-side, never trusted from the client.** `src/lib/pricing.ts`'s
  `resolveUnitPriceCents` (quantity-break tiers, highest qualifying `minQuantity` wins) is called
  from `src/lib/orders.ts`'s `createDraftOrder`/`addOrderItem` — the only two places an
  `OrderItem.unitPriceCents` gets set. MOQ (`Product.moq`) is enforced at the same two call sites.
  UI forms (new-order cart, add-item form) call the same function client-side purely for display —
  the server call is what's authoritative.
- **Catalogue search is database-backed, never "load everything into memory."**
  `src/lib/ai/catalogue-search.ts` pulls a *bounded* candidate pool (SQL term-matches on name/SKU,
  unioned with a capped recent-active-products scan for variant-attribute terms that live in an unindexed JSON column and can't be
  filtered in SQL) rather than fetching the whole catalogue — this was an actual bug fixed during the
  catalogue-depth build (see `docs/PROGRESS.md`'s Phase 2 section for what broke and why). Don't
  reintroduce an unbounded `product.findMany({ where: { organizationId, active: true } })` with no
  `take` in a search path.
- **The AI eval harness is not the engine's own tests.** `tests/ai-engine.test.ts` scripts the
  model's responses to test the *engine's* orchestration (tool loop, draft-order wiring, error
  handling) — it needs no real judgment from the model at all. `src/lib/ai/eval.ts` (cases in
  `eval-cases.ts`, run live via `npm run ai:eval`, gated on a real `ANTHROPIC_API_KEY`) grades the
  model's *actual* judgment against defined acceptance criteria: does it match the right
  product/variant/quantity, ask instead of guessing when genuinely ambiguous, never fabricate a
  discount/confirmation/claim, incorporate a customer's correction. It has no dedicated
  "escalated" state to check (the engine always sets `AI_HANDLING` whether it drafted an order or
  asked a question) — "escalated," for grading purposes, is operationalized as "did not create a
  confident draft order." Price accuracy is always 100% by construction, not something the model
  can get wrong: `createDraftOrder` resolves price server-side regardless of what the model
  states — still reported, since VISION.md names it as a metric to track.

## Design system

Loaded via the `frontend-design` skill — see the plan recorded in the first `/login` and dashboard
build. Summary: deep indigo `#1b2340` (ink) + warm paper `#f7f5f1` background + marigold accent
`#c8841e` used sparingly; IBM Plex Sans for UI text, IBM Plex Mono (`.font-tabular` / `font-mono`)
reserved for numeric/reference table columns (money, SKUs, phone numbers, order refs) where digit
alignment is functional, not decorative. Four semantic status tones only: neutral/progress/
success/attention (`src/components/status-badge.tsx`). No shadows, minimal consistent radius, flat
hairline-divided sections instead of card soup. Re-load the `frontend-design` skill before adding
any new screen type, not just the first one.

Any text input pre-filled with a real, non-placeholder default value a user is likely to just
overtype (e.g. the "colour"/"size" starting rows in `product-form.tsx`'s attribute editor) needs
`onFocus={(e) => e.target.select()}` — otherwise a click-and-type without clearing first appends to
the existing text instead of replacing it. Caught as a real bug once (produced `"colourcolour"`).

## Running it

```
npm run dev           # dev server
npm run db:migrate    # prisma migrate dev
npm run db:seed       # reset + reseed realistic fixture data
npm run db:studio     # prisma studio
npm run db:check-isolation  # confirm the live DATABASE_URL connection is actually subject to RLS
npm run test          # vitest — runs against a throwaway Postgres database (TEST_DATABASE_URL), never dev data
npm run ai:eval        # AI eval harness against the REAL model — needs ANTHROPIC_API_KEY; writes
                       # throwaway organizations to DATABASE_URL (reseed afterward in dev)
```

Dev login (from seed): owner `flomglobal@gmail.com` / `owner-dev-pass` (also STAFF in the second
organization, Lagos Spice Traders), staff `chidinma@adaezewholesale.ng` / `staff-dev-pass`, and
`ife@spicetraders.ng` / `spice-dev-pass` (owner of Lagos Spice only — can't see Adaeze's data).

## External integrations (not configured in this environment)

`WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_APP_SECRET` /
`WHATSAPP_VERIFY_TOKEN` (see `.env.example`) and `ANTHROPIC_API_KEY` are required for real WhatsApp
sending/ingestion and AI product-matching respectively. `RESEND_API_KEY` / `EMAIL_FROM` (and
optionally `APP_URL`, for a clickable link in the email) are required for the email notification
channel. Without any of these the app degrades gracefully (clear "not configured" messages in the
UI, see `isWhatsAppConfigured()` / `isEmailConfigured()` / the AI assist action) rather than
failing silently or pretending to work — the logic itself is tested against synthetic signed
payloads / mocked responses in `tests/`, not against the real services. See `docs/PROGRESS.md` for
exactly what's been verified vs. what needs real credentials to confirm.

## What's deferred (do not build yet)

See VISION.md Part 2 "Explicitly deferred". Built since that list was written: multi-tenant
isolation enforcement, customer-merge logic, bulk operations (order bulk-assign, previewed), basic
reporting, in-app notifications, an email notification channel layered on top of them,
per-organization SLA configuration, WhatsApp delivery-status tracking (sent/delivered/read/
failed on outbound messages — VISION.md's Phase 5 "ingestion/delivery tracking"), and a formal AI
eval harness (`src/lib/ai/eval.ts`, `npm run ai:eval`) — see `docs/PROGRESS.md` for what shipped
and what's still intentionally narrower than VISION.md's full Phase 4/5/Part 1 ambition. Still
deferred: billing, platform super-admin, automated payment verification, an SMS channel (email is
the only push channel so far), non-WhatsApp messaging channels, saved/scheduled reports, live
*courier/physical* delivery-tracking integration (not to be confused with the WhatsApp message
delivery-status tracking above — that's Phase 6 territory, a different "delivery" entirely), the
full configurable-automation engine VISION.md describes (triggers/conditions/actions/execution
logs/retry) — what shipped is narrower: one fixed trigger (a new/changed notification-worthy
event) with one fixed action (notify), not a
general rule builder.

## First-time setup (new machine or cloud session)

Work from `app/` (this file lives here, not at the repo root).

```
docker compose up -d db     # Postgres 16 on :5432, plus the restricted `wholesale_app` role
cp .env.example .env        # then set AUTH_SECRET: openssl rand -base64 32
                            # (DATABASE_URL = restricted app role, DIRECT_URL = owner; see docs/ISOLATION.md)
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

## Gotchas learned the hard way

- **Reseeding makes browser sessions stale.** After `npm run db:seed`, the JWT cookie still holds
  the old (deleted) organizationId/userId, so every page silently shows empty data. Sign out via
  `/api/auth/signout` and log back in. Navigating to `/login` while still signed in just bounces
  to `/` before any credentials can be submitted.
- **Tests share one Postgres test database** (`TEST_DATABASE_URL`; the name must end in `_test` —
  setup refuses anything else — and it is wiped and re-migrated each run; `fileParallelism: false`).
  A test that creates an `Organization` with no `whatsappPhoneNumberId` and relies on being "the
  only one" for webhook routing (`resolveOrganizationForWhatsApp`'s single-tenant fallback) needs
  its own data wiped in `beforeAll` first, or another test file's leftover orgs break the
  fallback — see `tests/end-to-end-flow.test.ts`.
- **New Prisma model with a foreign key?** Add its `deleteMany()` (child before parent) to both
  `prisma/seed.ts` and `tests/end-to-end-flow.test.ts`. (Forgotten twice now — it only fails when the
  full suite runs, because other test files leave rows behind.) Missing this once caused an FK failure
  that only appeared when the full suite ran, not in isolation.
- **Stale Turbopack cache** can produce phantom runtime errors ("X is not a function") for exports
  that are correct and pass tests. Kill the dev server, delete `.next/`, restart.
- **Chrome extension screenshots** (`Page.captureScreenshot`) can hang for a whole session while
  `read_page` keeps working. Don't skip verification: use DOM inspection plus direct DB checks
  (`node -e` with Prisma). That combination caught real bugs.
- **Don't submit Chrome-autofilled credentials** when testing login; clear the fields and type the
  seeded dev credentials explicitly.
- **Prisma is pinned to v6** (v7 needs driver adapters). Stopping the dev server before
  `prisma generate` avoids an EPERM file-lock on Windows.
- **Migrations are hand-edited when data must move.** `prisma migrate dev` is interactive and refuses
  to run from an agent; generate SQL with `prisma migrate diff --from-migrations prisma/migrations
  --to-schema-datamodel prisma/schema.prisma --shadow-database-url <scratch db> --script`, put it in
  a new `prisma/migrations/<timestamp>_name/migration.sql`, and add backfill SQL for existing rows
  (see `…_stock_figures`). Migration folders sort lexically — a timestamp earlier than the baseline
  runs first and fails on a fresh database. Test a backfill on a legacy-shaped scratch DB.
- **Playwright screenshots can trigger a dev-only hydration warning** ("1 Issue" badge) because
  Playwright injects `caret-color: transparent` into inputs. Not an app bug — check the console
  without screenshots before chasing it. Also: `waitForURL(/\/orders\/.+/)` matches `/orders/new`
  immediately; use `(?!new)`.
- **`prisma migrate reset` is blocked for agents** (needs the user's consent), and the test harness
  doesn't use it — it drops and recreates the `_test` schema itself.
- **A permission check on a mutable "ownership" field must look at the *current* value, not just
  the requested new one.** `assignWork`'s first draft let staff reassign work to themselves even
  when someone else currently held it (`toSelf` was checked alone) — a real privilege-escalation
  bug, caught by a test (`tests/operations.test.ts`) before it shipped, not found by inspection.
  When reviewing an authorization check, ask "what if the *current* state, not just the requested
  one, belongs to someone else?"
- **A `useEffect` "run exactly once" guard built from a `useRef` set synchronously inside the
  effect is broken under React's dev-mode double-invoke** (mount → cleanup → remount, same
  component instance, same ref). The ref survives the cycle already `true`, so the second
  (surviving) effect bails out before scheduling anything, and the first (real) effect's work was
  already undone by the cleanup — the effect silently never runs. Happened to `MarkReadOnView`
  (visiting `/notifications` never actually marked anything read); fixed by keying the effect on a
  value derived from its real dependency instead of a fire-once ref. This class of bug doesn't show
  up in Vitest (no effect timing) or in a plain `tsc`/`lint` pass — only live in a browser.
  Screenshots also caught a real UI bug this way: a conversation's attention-queue row showed the
  customer's name twice (two fields were both set to it) — eyeball what a page actually renders,
  not just that it renders without an error.
- **Local Postgres in this sandbox doesn't survive a session/worker restart.** If `pg_isready -h
  localhost -p 5433` doesn't respond, restart it with `su pgrun -c "/usr/lib/postgresql/16/bin/
  pg_ctl -D /var/pgdata -o '-p 5433 -k /tmp' -l /var/pgdata/log start"` before anything else
  (migrations, tests, `npm run dev`) will work. Check this first if commands that touched the
  database start failing right after a restart.
- **Destructuring a `client.$transaction([a, b, c])` array result by position is exactly as
  fragile as it looks — one added statement silently shifts every index after it.** `userScoped()`
  (`src/lib/db.ts`) added a second `set_config` call ahead of the real query but kept the original
  two-statement destructure, `const [, result] = await client.$transaction([...])` — index 1,
  which is now the *second* `set_config`'s result (always row-count 1), not index 2, the actual
  query. Every read through it returned that `1` reshaped as if it were real data instead of the
  query result, which looked enough like success that it took an actual assertion on real counts
  (`tests/operations.test.ts`) to notice. Fixed by destructuring the *last* element, which also
  made the bug impossible to reintroduce by adding a fourth statement later. When a tuple's shape
  depends on how many statements precede the one you want, index from the end or name every
  element — don't leave a hardcoded position that only happened to be correct for the old length.
