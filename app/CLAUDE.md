# Adaeze Wholesale — order operations platform

Full product vision and the Phase 1 brief: [docs/VISION.md](docs/VISION.md). Read it before making
any architectural decision — Part 2 defines what's in scope right now, Part 1 is the destination
the foundation should grow toward. Keep [docs/PROGRESS.md](docs/PROGRESS.md) current as work lands.

## Stack and why

- **Next.js 16 (App Router) + TypeScript**, single deployable app — frontend, auth, and data access
  together, matches the "modular, not microservices" guidance in VISION.md for this stage.
- **Prisma + SQLite** for local dev (`prisma/dev.db`, zero setup). **Switch to Postgres before any
  real concurrency or production use** — SQLite serializes writes, which is unsafe for the
  overselling-prevention and transactional-stock requirements in VISION.md once there's real
  traffic. Swapping the datasource provider in `prisma/schema.prisma` is the only change needed;
  the schema itself was written to be Postgres-compatible (money as integer cents rather than
  `Decimal`, since Prisma's `Decimal` type isn't available on SQLite).
- Pinned to **Prisma 6**, not 7 — Prisma 7 requires driver adapters even for SQLite, which adds
  setup complexity with no benefit at this stage.
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
- **Stock is a ledger.** `StockMovement` rows are the only source of truth for inventory; current
  stock = `SUM(quantityDelta)`. Never add an editable quantity column to `Product`.
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
  unioned with a capped recent-active-products scan for variant-attribute terms SQLite can't filter
  in SQL) rather than fetching the whole catalogue — this was an actual bug fixed during the
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
npm run test          # vitest — runs against a throwaway prisma/test.db, never dev data
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
