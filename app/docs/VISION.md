A reference document for an AI-powered order operations platform — a separate venture from Lois's other work. Part 1 is the full long-term vision (the destination). Part 2 is the scoped Phase 1 brief to hand to Claude Code now. Keep this doc in the repo (e.g. docs/VISION.md, or linked from CLAUDE.md) so every build session can see where Phase 1 fits into the whole.

# Part 1 — The Full Picture (Long-Term Vision)

## Product vision

An AI-powered order operations platform for businesses drowning in high-volume customer conversations and orders — fashion/beauty/footwear wholesalers, distributors, and general merchandise vendors currently running on WhatsApp messages, spreadsheets, notebooks, payment screenshots, and staff memory. As order volume grows, mistakes get expensive: customers repeat themselves, orders get missed, prices go stale, payments are hard to reconcile, deliveries slip, complaints vanish into chat history, and the owner becomes the single point of failure for every problem.

Central promise: turn customer conversations into accurate, trackable orders, and give the business control over everything that happens after. Customers enquire and order naturally through messaging channels; the business gets structured, verifiable records instead of manually reconstructing orders from chat. Every order has a clear status, a responsible person, an audit history, and a reliable path from enquiry to fulfillment. This is an order operations system with AI as its conversational interface — not a chatbot with extra features.

## Product principles (govern every decision)

- **Accuracy over autonomy** — the AI never invents products, variants, prices, stock, discounts, payment confirmations, delivery dates, customer records, order statuses, or policies. Ambiguity → ask or escalate, never guess.
- **Structured data is the source of truth** — the database is authoritative; the AI interprets and proposes, it never decides what inventory, payment, or order status actually is.
- **Human oversight where it matters** — configurable automation: answering from verified catalogue data can be automatic; confirming orders, exceptional discounts, and refunds require human/customer approval; marking payment received depends on verified evidence, never AI judgment or customer claim alone.
- **Every important action is traceable** — who / what / when / why / before / after / success-or-failure / evidence, for every consequential action.
- **Make exceptions visible** — unconfirmed orders, stock discrepancies, failed payments, overdue deliveries, complaints, and failed integrations must be easy to find and assign, not buried under pretty charts.
- **Design for operational speed** — searchable tables, fast filters, bulk actions, keyboard access, clear status indicators over hundreds of orders.
- **Build for real businesses** — poor networks, duplicate messages, staff mistakes, concurrent stock changes, messy customer messages, flaky third-party APIs. Never assume perfect data.

## Core order lifecycle

Enquiry → product identification → stock/price validation → order draft → customer confirmation → order acceptance → payment → inventory reservation → picking → packing → dispatch → delivery → completion.

Exceptions (product unavailable, ambiguous request, wrong quantity, price disagreement, order change, underpayment, duplicate payment, payment verification failure, partial fulfillment, damaged/missing items, delivery failure, cancellation, return/refund, complaint) are first-class workflows with defined permissions, validation, side effects, and audit events — never arbitrary status changes.

## Multichannel conversations

WhatsApp Business Platform first; Instagram, Telegram, and website chat added as a well-architected integration layer allows, investigating each channel's real API constraints before committing. A unified inbox shows every conversation regardless of channel: customer identity, source channel, history, linked orders, products discussed, payment/fulfillment context, assigned employee, status (new / AI handling / awaiting customer / awaiting staff / escalated / resolved), last messages, wait duration, priority, escalation reason.

Message handling must cover webhook signature verification, duplicate-event detection, idempotent processing, ordering under concurrency, retries, failed-message visibility, delivery status, rate limits, and integration health — never assume a message was delivered just because it was sent.

## The AI conversational engine

The AI interprets natural requests (e.g. "20 black two-piece sets, medium, how much?"), identifies product/variant/quantity, and validates against the real catalogue — asking for clarification on multiple matches, quoting only against real stock, offering alternatives when stock is short, and always presenting the full itemized order for confirmation before it's finalized.

It acts only through explicit, permission-controlled tools (search catalogue, retrieve product/stock/pricing, calculate quote, create draft order, retrieve order status, request confirmation, escalate, retrieve delivery info, create support case) with defined schemas, validation, and failure handling — never unrestricted database access, never a claimed action without application confirmation.

Product matching combines exact SKU/code matching, catalogue search, names/aliases, variant attributes, customer descriptions, and semantic search (image matching where feasible) — never relying solely on embeddings or an LLM. Every match needs an explainable basis; low-confidence matches trigger clarification or human review.

AI evaluation: a test suite of realistic, ambiguous, misspelled, multi-item, and adversarial messages, measuring product/variant/quantity/price accuracy, unsupported claims, missed/unnecessary escalations, completion rate, and correction frequency — with model versions and tool results recorded for investigation. The AI is never called production-ready without evaluation against defined acceptance criteria.

## Catalogue, inventory, and orders

Catalogue scales to thousands of products/variants (size, colour, material, model, packaging, business-specific attributes) with full commercial fields (cost/selling/wholesale price, MOQ, price tiers, tax, status). Units and conversions are explicit (a carton is not a piece) with CSV import/export that validates and previews before committing.

Inventory is a ledger, not an editable number — every movement (initial stock, purchase received, sale reserved/fulfilled, reservation released, return, damage, manual adjustment, transfer) has a reason, timestamp, reference, and source. Physical / reserved / available / damaged stock are distinct, with transactional controls preventing overselling under concurrent purchases. Catalogue search is database-backed with indexing/pagination/caching, never the full catalogue loaded into AI context; cached data has defined freshness rules.

Orders are the central entity: reference, customer, source conversation/channel, items, variants, quantities/units, prices, discounts, tax, total, currency, payment state, fulfillment state, delivery details, assignment, timestamps, deadlines, notes, full audit history. Agreed commercial terms are locked at confirmation — a later catalogue price change never silently alters a confirmed order. Supports drafts, amendments, cancellations, returns, refunds, duplicate-order investigation, and full customer order history; a conversation can hold several orders, an order several payment/fulfillment events.

## Payments and fulfillment

Payment status rests on verified evidence only — never a customer's claim, a screenshot, or an AI guess. States: unpaid / pending / partially paid / paid / failed / overpaid / refund pending / partially refunded / refunded, with defined transitions, idempotent processing via provider transaction IDs, and routing to an authorized human wherever automated verification isn't available.

Fulfillment tracks awaiting-fulfillment → picking → packing → dispatch → delivery → exceptions, with every status change recording actor and timestamp, partial fulfillment support, a practical manual workflow where no delivery integration exists, and configurable deadline/escalation rules for stuck orders — never pretending to have tracking a provider doesn't actually expose.

## Staff, dashboard, search, customers, automation, reporting

Role-based permissions built around actions, not page visibility (owner, admin, sales, inventory, payment verification, fulfillment, support, configurable others). Task/order/conversation ownership, team queues, internal notes, escalation, overdue visibility, reassignment — without building an employee-management suite nobody needs yet.

The owner's control room answers: what needs attention now, which orders are at risk, where work is stuck, which customers are waiting, payment/fulfillment state, which people/processes need intervention. Sections: needs-attention queue, order pipeline, operational performance (response time, fulfillment time, overdue count, cancellation/refund/escalation rates) — every metric computed from real records and linked to the records behind it, never fabricated or inflated.

Global search and filters across orders/customers/products/SKUs/conversations/payments/tracking references; safe bulk actions (assign, export, reassign, send approved notifications) that preview impact, validate permissions, handle partial failures, and log outcomes — never a silent destructive bulk op.

Unified customer records (identity, verified contact, conversation/order history, balances, addresses, custom pricing, notes, support cases, consent) with careful duplicate detection — never auto-merging on name similarity alone.

A configurable automation system (triggers: new enquiry, order created, confirmation received, payment verified, stock discrepancy, overdue order, delivery change, escalated complaint, integration failure → actions: notify, assign, escalate, send approved update, trigger workflow, queue) with explicit conditions, permissions, execution logs, retry behavior, loop safeguards, and no duplicate notifications on retry.

Reporting covers sales, orders, product demand, stock movement, payment reconciliation, outstanding balances, fulfillment performance, delivery exceptions, staff workload, response times, and AI escalation performance — clearly separating revenue, order value, cash received, receivables, refunds, and profit (profit only computed when real cost data exists, assumptions documented, revenue never mislabeled as profit).

## Multi-tenant SaaS, security, admin, commercial model

Each business gets an isolated workspace (organizations, users/memberships, roles, products, locations, customers, conversations, orders, payments, fulfillment, integrations, automations, audit logs, subscription/usage records) with tenant isolation enforced server-side — never just frontend filtering — and automated tests that specifically try to cross tenant boundaries. Shared SaaS infrastructure by default; dedicated infrastructure only with a clear reason.

Security: authentication, server-side authorization, RBAC, tenant isolation, input validation, secrets management, rate limiting, common-vulnerability protection, safe uploads, secure webhooks, session management, backups, error monitoring, retention controls, audit logging. Payment and customer data are sensitive by default; least-privilege access; no credentials or PII in logs; consequential admin actions are auditable; applicable data-protection requirements (Nigerian and any other markets entered) are investigated, never assumed compliant without evidence.

Platform-level super-admin (organization management, subscription/usage health, integration failures, platform errors, support workflows, account restrictions, security events, audit history) stays separate from customer-org admin, permission-controlled and auditable; any support impersonation is explicit, time-limited, and visibly flagged — never an unrestricted database-editing backdoor.

Commercial model (staff seats, channels, order volume, AI usage, catalogue size, locations, advanced reporting) is designed for later — foundations for plans, entitlements, usage metering, billing status, and subscription lifecycle, without inventing final pricing or limits before real customer needs and costs are known. Subscription payment success is never confused with an individual order's payment accuracy.

## UI/UX direction — this matters a lot

This has to read as a serious, polished, professional B2B operational tool — not a generic AI-dashboard template. Explicitly avoid: excessive gradients, glassmorphism, oversized decorative cards, empty hero sections inside the actual app, over-rounded containers, unnecessary animation, dense/confusing layouts, bloated navigation, decorative charts with no operational value, repeated information across cards.

Prioritize instead: clear visual hierarchy, information density without clutter, strong typography, consistent spacing, restrained colour, excellent table design, unambiguous status indicators, useful empty states, contextual actions, fast search, full responsiveness, accessible contrast and keyboard interaction. Desktop is built for efficient high-volume processing; mobile is built for quick operational actions and conversation handling — never just a shrunk desktop table. Every screen (inbox, catalogue, order detail, payments, fulfillment queues, admin) should feel like one coherent product, using realistic data in every fixture, never placeholder lorem-ipsum or fake happy-path screenshots.

## Technical architecture principles

Investigate the real repo state before any architectural decision; preserve working code. Clear separation of frontend, auth, business logic, data access, AI orchestration, messaging integrations, background jobs, notifications, billing, and audit logging — modular, not microservices, at this stage. Database transactions for anything that must succeed/fail together; queues for durable background work; idempotency for retried operations; migrations and version control for schema; secrets never in frontend code; integrations are never faked as working when they're mocked.

## Testing discipline

Testing is a product requirement, not a final step. Priority scenarios to always define expected behavior for: simultaneous purchase of the last units; a duplicate payment webhook; a repeated order request; multiple similar variants; a quantity change after quoting; a catalogue price change after confirmation; a delayed payment webhook; an unauthorized refund attempt; a messaging integration going down; a partially fulfilled order; a message arriving after an earlier one failed; a cross-tenant access attempt; a stock import with duplicate/invalid SKUs; a retried notification job. A feature is never "done" just because the happy path works.

## Phased build order (destination, not a rule to delay architecture)

- **Phase 1 — Foundation**: architecture, auth, orgs/memberships, tenant isolation, migrations, shared UI system, navigation.
- **Phase 2 — Catalogue & inventory**: products/variants, SKUs, stock movements, reservations, search, import/export, validation.
- **Phase 3 — Orders & customers**: customer records, order creation/items/pricing/lifecycle, search, history, audit events.
- **Phase 4 — Operations control room**: actionable dashboard, queues, assignment, fulfillment workflows, exceptions, notifications, reporting.
- **Phase 5 — Unified inbox & AI**: conversations, messaging integration architecture, ingestion/delivery tracking, catalogue-grounded AI, product matching, draft orders, confirmation, escalation, evaluation.
- **Phase 6 — Payments & delivery**: payment records, provider integration, verification, reconciliation, fulfillment tracking, delivery integrations where justified, customer notifications.
- **Phase 7 — Commercial launch**: subscriptions, usage metering, platform admin, monitoring, backups, deployment, docs, security review, pilot onboarding.

Definition of success: a real, high-volume business can receive enquiries, get correct products identified, generate accurate orders, verify payments, track fulfillment, assign responsibility, and resolve exceptions — without anyone manually remembering everything. Build a reliable order operations system that happens to use AI, not an unreliable AI system that happens to manage orders.

# Part 2 — Phase 1 Kickoff (what Claude Code builds right now)

## Why Phase 1 is scoped this tightly

Lois is a solo founder, starting from scratch, with no design partner yet. The full vision above is 12-18+ months of team-scale SaaS work. Building the whole thing before anyone has used it is the biggest real risk here — so Phase 1 is deliberately a thin, real, usable slice: one tenant, one channel, one modest catalogue, the full order lifecycle done honestly (draft → confirm → manually-marked paid → fulfilled), with an inventory ledger from day one because that's cheap now and expensive to retrofit later. Everything else in Part 1 is the destination this foundation should grow into — not something to half-build now.

## Phase 1 scope — build this

- One business (single tenant for now, but keep org/tenant boundaries in the data model from day one so Phase 3's multi-tenancy doesn't require a rewrite).
- One channel: WhatsApp Cloud API webhook ingestion and reply.
- A catalogue of dozens-to-a-few-hundred SKUs with basic variants (size/colour), prices, and active status.
- Inventory ledger (stock\_movements) as the source of truth for stock — never a directly-editable quantity field.
- Full order lifecycle: enquiry → AI-drafted order (proposed, never auto-committed) → customer/staff confirms → staff manually marks paid → staff marks fulfilled.
- Basic roles: owner vs. staff — not full RBAC yet.
- A simple unified view: open conversations, their linked orders, today's activity.
- An audit\_log table from day one, even minimal — cheap now, invaluable later.
- Genuinely good UI from the first screen — see UI requirement below. This is not a placeholder-UI-now, polish-later project.

## Explicitly deferred — do not build yet

- Multi-tenant isolation enforcement, billing/subscriptions, platform super-admin.
- Automated payment gateway verification — mark paid manually by staff for now.
- Automation/notification engine.
- Instagram, Telegram, website chat — WhatsApp only.
- Formal AI evaluation harness — basic sanity checks on product matching are enough for now.
- Advanced reporting/BI, bulk operations, customer-merge logic.

## UI requirement — non-negotiable for Phase 1

This needs to be a genuinely well-designed interface from the very first screen, not scaffolding to prettify later. Follow the UI/UX direction in Part 1 exactly: clear hierarchy, strong table design, restrained colour, real empty states, accessible contrast and keyboard interaction, no generic AI-dashboard clichés, no decorative clutter. Use the frontend-design skill/guidance when building any screen. Every fixture (products, orders, conversations) should use realistic names and data, never lorem-ipsum or obviously fake placeholders — the UI should look and feel like a real, already-in-use product from day one.

## Minimum data model for Phase 1

- **products** — name, SKU, variant attributes, price, active status.
- **stock\_movements** — product\_id, variant, quantity\_delta, reason, reference, timestamp. Current stock = sum of movements; never edited directly.
- **customers** — phone number as identity, name, notes.
- **conversations** — customer\_id, channel, status (new / ai\_handling / awaiting\_staff / resolved), last\_message\_at.
- **orders** — customer\_id, conversation\_id, status (draft / confirmed / paid / fulfilled / cancelled), items, total, created\_at.
- **order\_items** — order\_id, product\_id, variant, quantity, unit\_price (locked at confirmation — never recalculated from a later catalogue price change).
- **audit\_log** — entity, entity\_id, action, actor, before/after state, timestamp.

## The AI's job in Phase 1 — scoped tightly

Read an incoming WhatsApp message, search the catalogue, and propose matched product(s)/quantities. If ambiguous or no confident match, ask a clarifying question — never guess. Draft an order from confirmed matches. Never auto-confirm an order and never auto-mark anything paid: staff or the customer always does the confirming step; the AI proposes, it never commits.

## Build order for Claude Code sessions

1. Repo setup, stack decision (explain the trade-off briefly, then decide), auth, base data model + migrations.
2. Catalogue CRUD + stock ledger — prove it can't oversell and every movement is traceable.
3. Conversation + order models, manual order creation flow with no AI yet — prove the lifecycle works by hand first.
4. WhatsApp Cloud API webhook ingestion (receive + store messages; reply manually at first).
5. Wire in AI product-matching — propose only, never commit.
6. Full draft → confirm → paid → fulfilled flow, end to end.
7. Minimal dashboard: open conversations, pending orders, today's activity — built to the UI standard above, not a placeholder.

Definition of done for Phase 1: real WhatsApp orders can run through this for two weeks without reverting to spreadsheets, and at least one real ambiguous product-matching case has been handled correctly or correctly escalated by the AI.

## How to work (applies every session)

Investigate the existing repo before any architectural decision; make sensible calls and explain significant trade-offs briefly, without over-explaining to someone who already has a dev/UI-UX background. Build working features, not descriptions of them. For each feature: define the behavior, implement frontend + backend, implement authorization/validation, handle errors, add tests, run checks, fix failures, verify behavior, update docs. Don't declare something done because the happy path works. If a decision is reversible, pick a sensible default and keep moving; if a decision risks real data loss, security exposure, real expense, or an irreversible architectural choice, flag it before proceeding. Keep a running record of what's done, what's outstanding, and the next concrete step — and treat Part 1 of this document as the destination the foundation is being built toward, even while only Phase 1 is being built.
