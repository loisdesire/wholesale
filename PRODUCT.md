# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are the owner and sales staff of a small Nigerian wholesale
fashion/garment business (seed data: "Adaeze Fashion Wholesale," a Lagos
trader). They work from a back-office web app during the business day,
fielding wholesale buyer inquiries that arrive over WhatsApp and Telegram,
converting them into tracked orders, and managing stock, payments, and
returns. A secondary, much smaller audience is the platform operator
(the SaaS vendor's own admin), who needs cross-tenant oversight without
visibility into any tenant's actual customer/order data.

## Product Purpose

Turns a wholesale fashion trader's customer chat threads (WhatsApp and
Telegram) into verified, trackable orders, replacing manual notebook/DM-based
order-taking. Stock reservation, customer-specific pricing, payment
reconciliation (Paystack + bank transfer), and returns/refunds all read from
one immutable ledger so the owner always has a correct, current picture of
what's owed, what's in stock, and what's shipped.

## Positioning

Not a generic storefront or generic CRM: the product meets traders where they
already sell — inside WhatsApp/Telegram chat — and uses AI (vision-based
product matching against the trader's own photographed catalogue, plus a
chat copilot) to answer buyer questions and propose matching stock directly
in that chat, before an order is ever created. Underneath, order/stock/money
state is commerce-grade: pessimistic stock locking, RLS-enforced tenant
isolation, and an append-only audit/stock-movement ledger.

## Operating Context

- Daily loop: inbound WhatsApp/Telegram message → AI drafts or staff writes a
  reply → confirmed intent becomes an order (Draft → Confirmed → Paid →
  Partially Fulfilled → Fulfilled, or Cancelled).
- Stock is tracked as physical / reserved / damaged, reconciled through a
  stock-movement ledger (initial stock, purchase received, sale reserved/
  fulfilled, returns, damage, manual adjustment).
- Returns and refunds have their own approval and payout workflow, owner-
  gated for financial actions.
- Staff/order/conversation assignment, SLA-based "needs attention" triage,
  and a reports/reconciliation view for the owner.
- Multi-tenant SaaS: each organization is billed on a Paystack subscription
  with plan-based quotas (staff seats, orders/month, AI replies/month); a
  separate platform-admin surface gives the vendor cross-tenant visibility
  without raw access to any tenant's customer or order records.

## Capabilities and Constraints

- Next.js (App Router) + Prisma + PostgreSQL with row-level security; all
  tenant data access goes through a `tenantDb(organizationId)` scope — there
  is no unscoped query path.
- Channels: WhatsApp Cloud API and Telegram Bot API, normalized into one
  conversation/message model; an AI engine (GPT-based) drafts replies, does
  visual product matching against photographed catalogue entries, and can
  send up to 3 product photos per reply.
- Automated test suite (391 tests) covers the order/stock/billing logic;
  this is depended on as a regression gate.
- Undecided/open: no production customers yet — the seed/test data (5 SKUs,
  a handful of test customers and conversations) is the only populated data
  this environment has ever shown.

## Brand Commitments

Product name: "Adaeze Fashion Wholesale" (seed/demo tenant name; the SaaS
product itself is not yet named independently of this demo tenant). No
other binding brand assets (logo, tagline, legal copy) exist yet.

## Evidence on Hand

No real customer logos, testimonials, press, or production usage numbers
exist. All screenshots, copy, and data seen in this environment are seed/
test fixtures (5 catalogue SKUs, ~8 test customers, a handful of seeded
conversations) built for development, not real trade activity. Future work
must not present these, or invented numbers, as real traction.

## Product Principles

- The ledger is the single source of truth: every stock or money figure
  shown anywhere must be derivable from immutable records (payments, stock
  movements, audit log) — never a value that can drift from hand-editing.
- Meet traders in the channel they already use: WhatsApp/Telegram chat is
  the primary customer-facing surface, not a separate buyer-facing portal.
- This is an Operate surface first: staff finishing tasks fast and
  correctly outranks marketing polish or visual flourish.
- Tenant isolation is non-negotiable and enforced at the data layer, not
  just in the UI.
