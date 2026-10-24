# Monitoring and backups

What exists today, what a real deployment needs before a pilot business depends on it, and why
each recommendation is sized the way it is. Nothing here has been set up yet — see
`docs/DEPLOYMENT.md` for the deploy sequence this builds on, and `docs/PROGRESS.md`'s "Known
gaps" for the standing caveat that this app has only ever run against a local Postgres.

## What exists today

- **A startup health check, not ongoing monitoring.** `src/instrumentation.ts` runs
  `checkTenantIsolation()` once when the server process starts. In production it **throws**,
  failing the process, if tenant isolation isn't actually enforced (wrong DB role, a tenant table
  missing RLS) — see `docs/ISOLATION.md`. A host that restarts a crashed process (which every
  reasonable host does) turns this into an effective health gate: a misconfigured deploy fails to
  come up rather than silently serving unisolated data. It says nothing about the app's health
  once it's running.
- **Unstructured logging only.** Eight `console.error`/`console.warn` call sites in the whole
  codebase today, all narrow and specific: the two webhook routes log when a Paystack/WhatsApp
  event can't be applied (bad reference, record-keeping error) but still return `200` so the
  provider doesn't retry forever; `src/lib/notifications.ts` logs when an individual email send
  fails (the in-app notification itself still succeeds — email is a best-effort layer on top, see
  `docs/PROGRESS.md`'s Phase 4 entry); `src/instrumentation.ts` logs the isolation warning in
  development. None of this goes anywhere but host-captured stdout/stderr today — no aggregation,
  no alerting, no dashboards.
- **Error tracking is wired in, but inert without a DSN.** `@sentry/nextjs` is installed;
  `sentry.server.config.ts` calls `Sentry.init()` only when `SENTRY_DSN` is set (same
  degrade-gracefully shape as every other integration — see CLAUDE.md), and `src/instrumentation.ts`
  loads it and exports `onRequestError = Sentry.captureRequestError`, Next.js's documented hook for
  catching exceptions from Server Components, Route Handlers and Server Actions. The two webhook
  routes also call `Sentry.captureMessage` on each of their existing rejection paths (bad
  reference, a payment/subscription that couldn't be applied, an unrouted WhatsApp event) — without
  `SENTRY_DSN` set, every one of these calls is a safe no-op (confirmed by the test suite, which
  exercises these exact paths with no DSN configured). **Without a real DSN, none of this actually
  reports anywhere yet** — it needs a real Sentry project, set up outside this environment. Also
  not done: `next.config.ts` isn't wrapped with `withSentryConfig` (needs a real org/project/auth
  token for source-map upload — skipping this still gives working error capture, just with
  minified stack traces until that's added), and only the Node.js runtime is covered, not edge
  middleware.
- **No APM / request tracing.** `tracesSampleRate: 0` in `sentry.server.config.ts` — no latency or
  throughput metrics beyond whatever the hosting platform captures for you. Turning this on is a
  one-line change once that's actually wanted.
- **No backup job of any kind.** Local development's Postgres (`docker-compose.yml`) has a plain
  Docker volume with no backup; nothing has been set up against a managed database either, because
  none has been chosen yet.

## Why the data model matters for backup strategy

Most of this app's tenant data is **ledger-based, append-only**: `StockMovement`, `Payment`,
`SubscriptionPayment`, `AuditLog` are never edited or deleted, only ever added to — see
`CLAUDE.md`'s "Data model conventions". A point-in-time restore therefore reconstructs a state
that is internally consistent on its own terms (stock on hand is still the sum of movements up to
that point; amount paid is still the sum of payments up to that point) rather than a snapshot that
might have mid-write inconsistencies. This is a real advantage worth choosing a backup provider
around, not just a nice property to mention — it means continuous WAL-based backup (point-in-time
recovery, not just nightly snapshots) is both valuable and low-risk here: restoring to "5 minutes
before the incident" genuinely gives back a coherent state, not a half-applied one.

## What to set up before a pilot depends on this

In rough priority order — cheapest/most load-bearing first:

1. **Managed Postgres with automated continuous backups and point-in-time recovery**, as part of
   choosing a host at all (`docs/DEPLOYMENT.md`). Nearly every managed Postgres provider (RDS,
   Supabase, Neon, Render, Cloud SQL) includes this by default — the work here is choosing a
   provider and confirming retention window and restore process, not building anything.
2. ~~An error-tracking SDK wired into Next.js's instrumentation hooks~~ — **done**: `@sentry/nextjs`
   is installed and wired into `src/instrumentation.ts`/`sentry.server.config.ts`, including
   `onRequestError` and the two webhook routes' rejection paths. What's left here is entirely
   outside this environment: create a real Sentry project and set `SENTRY_DSN` — everything else
   activates automatically once that's set, nothing more to build.
3. **Alerting on the two webhook routes specifically** is now wired in (see above) — what remains
   is configuring actual alert rules in Sentry once a real project exists (e.g. "page someone if
   more than N webhook rejections happen in 5 minutes"), which is Sentry dashboard configuration,
   not application code.
4. **A documented restore drill**, once backups exist: actually restore a backup to a scratch
   database and run `npm run db:check-isolation` against it, confirming RLS and the restricted
   role survive a restore (a snapshot/restore process on some providers recreates roles
   differently than the original setup — this is exactly the kind of thing that should be caught
   in a drill, not discovered during a real incident).
5. **Uptime/synthetic monitoring** (a periodic request to confirm the app responds) — lower
   priority than the above because a host's own health checks (tied to the startup isolation
   check, item 1 above) already catch the "didn't come up at all" case; this adds "came up but is
   now unresponsive."
6. **APM/request tracing** — lowest priority of this list. Useful once there's real traffic to
   reason about performance against; premature before then.

## What's deliberately not decided here

The actual provider choices (which managed Postgres, which error tracker, whether a single host
also offers adequate APM) depend on the hosting decision in `docs/DEPLOYMENT.md`, which is the
user's to make. This document describes what's needed and why it's prioritized this way, not which
vendor to sign up with.
