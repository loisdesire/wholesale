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
- **No error-tracking SDK** (Sentry or similar) is wired in. An uncaught exception in a server
  action or route handler is visible only in host logs, to whoever happens to be looking.
- **No APM / request tracing.** No latency or throughput metrics beyond whatever the hosting
  platform captures for you.
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
2. **An error-tracking SDK** (e.g. Sentry) wired into Next.js's instrumentation hooks
   (`src/instrumentation.ts` already exists as the place Next.js calls on startup — a
   `Sentry.init()` call belongs there, plus `onRequestError` per Next.js's documented hook for
   catching request-level exceptions). This is the single highest-value addition here: today an
   uncaught error in, say, order creation or a webhook handler is invisible unless someone is
   tailing logs at the right moment.
3. **Alerting on the two webhook routes specifically**, since they're the app's only unattended
   entry points (no human clicks "submit" when Paystack or WhatsApp calls in) and already log
   every rejection with enough detail to act on (`console.error` call sites listed above) — piping
   those into whatever error tracker is chosen immediately makes them actionable instead of
   silent. A failed/rejected webhook event today is acknowledged (so the provider doesn't retry
   forever) but otherwise invisible — "payment didn't apply and nobody noticed" is the realistic
   failure mode to guard against first.
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
