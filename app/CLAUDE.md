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
npm run test          # vitest — runs against a throwaway Postgres database (TEST_DATABASE_URL), never dev data
```

Dev login (from seed): owner `flomglobal@gmail.com` / `owner-dev-pass`,
staff `chidinma@adaezewholesale.ng` / `staff-dev-pass`.

## External integrations (not configured in this environment)

`WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_APP_SECRET` /
`WHATSAPP_VERIFY_TOKEN` (see `.env.example`) and `ANTHROPIC_API_KEY` are required for real WhatsApp
sending/ingestion and AI product-matching respectively. Without them the app degrades gracefully
(clear "not configured" messages in the UI, see `isWhatsAppConfigured()` / the AI assist action)
rather than failing silently or pretending to work — the logic itself is tested against synthetic
signed payloads / mocked responses in `tests/`, not against the real services. See
`docs/PROGRESS.md` for exactly what's been verified vs. what needs real credentials to confirm.

## What's deferred (do not build yet)

See VISION.md Part 2 "Explicitly deferred": multi-tenant isolation enforcement, billing,
platform super-admin, automated payment verification, the automation/notification engine,
non-WhatsApp channels, a formal AI eval harness, advanced reporting, bulk operations,
customer-merge logic.

## First-time setup (new machine or cloud session)

Work from `app/` (this file lives here, not at the repo root).

```
docker compose up -d db     # Postgres 16 on :5432 (or point DATABASE_URL at any Postgres)
cp .env.example .env        # then set AUTH_SECRET: openssl rand -base64 32
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
  Code that depends
  on "the one organization" (the WhatsApp webhook resolves its org via `organization.findFirst()`)
  needs its test to wipe all data in `beforeAll` first — see `tests/end-to-end-flow.test.ts`.
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
