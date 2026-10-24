# Deployment

This document describes how to take the app from "runs locally against Docker Postgres" to
"runs against a real host with a managed database." Nothing here has been exercised against a
real host yet — see `docs/PROGRESS.md`'s "Known gaps" for what's still unverified. Read
`docs/ISOLATION.md` first; tenant isolation is load-bearing for everything below.

## Shape of the deployment

- **App**: a single Next.js 16 app (App Router, Node runtime — not Edge, since Prisma needs
  Node). `npm run build` then `npm run start`, or any host that runs that for you (Vercel,
  Render, Fly.io, a plain VM behind a reverse proxy). No background workers, queues, or cron
  jobs exist yet — everything in this app runs inside an HTTP request or a webhook POST.
- **Database**: Postgres 16+. Tenant isolation depends on row-level security (RLS), which
  requires the app to connect as a *non-superuser, non-`BYPASSRLS`* role — this is non-negotiable,
  not a hardening nice-to-have. Most managed Postgres (RDS, Supabase, Neon, Render Postgres,
  Cloud SQL) gives you a non-superuser app role by default; only be careful not to grant it
  superuser or `BYPASSRLS` out of convenience.
- **File storage**: inbound WhatsApp images are stored as bytes directly in Postgres
  (`MessageAttachment.data`, a `BYTEA` column) rather than an external object store — a deliberate
  choice to avoid a new infra dependency/account before there's a real need, see CLAUDE.md's
  billing/attachments notes. No other user uploads are stored outside the database (catalogue CSV
  import/export and report CSV export are both streamed in the request, never written to disk).
  Revisit object storage (S3/R2/Cloudinary) if attachment volume ever makes Postgres row/table
  size a real concern — nothing today needs that decision made yet.

## Environment variables

Copy `.env.example` and fill in real values. Two are new for this app vs. a typical Next.js app:

| variable | required in production | notes |
|---|---|---|
| `DATABASE_URL` | yes | the **restricted** role (`wholesale_app` locally) — see docs/ISOLATION.md. The app refuses to start without RLS actually enforced (`src/instrumentation.ts`), unless `ALLOW_UNENFORCED_ISOLATION=true` is set, which should never be set in production. |
| `DIRECT_URL` | yes, for migrations only | the database owner. Used by `prisma migrate deploy` and `npm run db:seed` — never by the running app itself. Many hosts let you point this at the same database with a different (owner) connection string. |
| `AUTH_SECRET` | yes | `openssl rand -base64 32`. Rotating it invalidates all sessions. |
| `APP_URL` | yes, if `RESEND_API_KEY` is set | base URL used to build absolute links in notification emails. Without it emails still send, just without a clickable link. |
| `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_APP_SECRET` / `WHATSAPP_VERIFY_TOKEN` | optional | WhatsApp Cloud API. The app degrades gracefully without it — inbox/replies via WhatsApp simply don't work until configured. One global credential today, not per-organization (see `docs/PROGRESS.md`). |
| `ANTHROPIC_API_KEY` | optional | AI product matching on inbound messages. Degrades gracefully without it. |
| `RESEND_API_KEY` / `EMAIL_FROM` | optional | email notification channel. In-app notifications work regardless. |
| `PAYSTACK_SECRET_KEY` | optional | order payments *and* subscription billing both go through this one key (see `src/lib/billing.ts`, `/billing`) — webhook events are signed with it too, no separate webhook secret. One global account today, not per-organization. |
| `TEST_DATABASE_URL` / `TEST_APP_DATABASE_URL` | no | local/CI test runs only; never set in a deployed environment. |

Every optional integration follows the same `isXConfigured()` pattern: missing credentials mean
a clearly-labelled "not configured" state in the UI, never a silent failure or a fake success.
It's safe to deploy with only `DATABASE_URL`/`DIRECT_URL`/`AUTH_SECRET` set and add the rest later.

## First deploy, step by step

1. **Provision Postgres 16+.** Create the database and a superuser/owner connection string —
   this becomes `DIRECT_URL`.
2. **Create the restricted role** the app will actually connect as. Locally this is done by
   `docker/init-app-role.sql` via `docker compose`; on a managed host, connect as the owner and
   run once:
   ```sql
   CREATE ROLE wholesale_app LOGIN PASSWORD '<a real secret, not the dev default>';
   GRANT CONNECT ON DATABASE <dbname> TO wholesale_app;
   GRANT USAGE ON SCHEMA public TO wholesale_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wholesale_app;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wholesale_app;
   ```
   (Migrations run as the owner and create new tables after this role exists, so the
   `ALTER DEFAULT PRIVILEGES` line matters — without it, a table added by a later migration isn't
   grantable to `wholesale_app` until you re-run the grant by hand.) Use this role's connection
   string as `DATABASE_URL`.
3. **Run migrations**: `DIRECT_URL=... npx prisma migrate deploy`. This applies every migration
   in `prisma/migrations/` in order, including each one's RLS `ENABLE`/`FORCE`/`CREATE POLICY`
   statements — isolation is established by the migrations themselves, not a separate step.
4. **Seed only if this is a fresh demo/staging environment**, never production:
   `DIRECT_URL=... npm run db:seed`. It wipes and recreates two demo organizations with known
   dev passwords (`prisma/seed.ts`) — do not run it against a database with real customer data.
5. **Verify isolation is actually enforced** before taking traffic:
   `DATABASE_URL=... npm run db:check-isolation`. The app also runs this at startup
   (`src/instrumentation.ts`) and refuses to start in production if it fails — this step just
   lets you catch it before the first deploy rather than from a crash loop.
6. **Build and start**: `npm run build && npm run start` (or let the host's Next.js buildpack do
   this). Set `NODE_ENV=production`.
7. **Point webhooks at the deployed URL**, once the relevant credentials are set:
   - WhatsApp Cloud API webhook → `https://<host>/api/webhooks/whatsapp` (verify token =
     `WHATSAPP_VERIFY_TOKEN`).
   - Paystack webhook → `https://<host>/api/webhooks/paystack`. One URL handles both order
     payments and subscription-billing payments (`src/lib/billing.ts`) — see
     `docs/PROGRESS.md`'s Phase 6/7 entries for how the single endpoint tells them apart.

## Ongoing operations

- **New migrations**: `prisma migrate deploy` against `DIRECT_URL` as part of your deploy
  pipeline, before the new app version starts serving traffic. Never `prisma migrate dev`
  (interactive, meant for local development) or `prisma db push` (skips the migration history and,
  critically, skips the hand-written RLS policy statements that live in each migration's SQL) in a
  deployed environment.
- **Backups**: not yet decided — depends on the managed Postgres provider chosen. At minimum,
  continuous WAL-based backups with point-in-time recovery; the ledger-based data model (stock
  movements, payments, subscription payments are all append-only) means a restore to any past
  point reconstructs a internally-consistent state, which is a meaningful advantage to rely on
  when choosing a backup strategy.
- **Monitoring**: not yet set up. There is no external error-tracking or APM integration in the
  app today — errors currently only go to console/host logs. The one built-in health signal is
  the isolation check at startup (`src/instrumentation.ts`), which fails the process (and so a
  typical host's health check / restart loop) if tenant isolation isn't enforced.
- **Secrets rotation**: rotating `AUTH_SECRET` invalidates all sessions (acceptable — users just
  sign in again). Rotating `PAYSTACK_SECRET_KEY` or `WHATSAPP_APP_SECRET` must happen in lockstep
  with updating the webhook configuration on Paystack's/Meta's side, since both are used to verify
  inbound webhook signatures, not just to make outbound calls.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and PR: a throwaway Postgres service container,
the restricted `wholesale_app` role created the same way `docker/init-app-role.sql` does locally,
`prisma migrate deploy`, `npm run db:check-isolation` (fails the build if tenant isolation isn't
actually enforced — the same check `src/instrumentation.ts` runs at startup, just moved earlier),
lint, the production build (Next.js runs its own full TypeScript check as part of `next build` —
a standalone `tsc --noEmit` step before it fails on the App Router's auto-generated
`LayoutProps`/`PageProps` types, which only exist once `next build`/`next dev` has run), and the
full test suite. It is **not** a deploy pipeline — it verifies the branch, it doesn't ship it
anywhere. A real CD step (running `prisma migrate deploy` against the real database and deploying
the build) still waits on the hosting decision
below.

## What's deliberately not here yet

Per VISION.md's Phase 7 scope and `docs/PROGRESS.md`'s "Suggested next steps": a CD step that
actually deploys (CI above only verifies), a chosen hosting provider, a chosen managed-Postgres
provider, log aggregation/APM, uptime alerting, and a documented backup/restore drill. These wait
on an actual hosting decision, which is the user's to make, not something to invent here.
