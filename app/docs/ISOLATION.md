# Tenant isolation

One organization must never be able to read or change another's data — through a bug, a
forgotten `where` clause, or a guessed id. Isolation is enforced **by the database**, with the
application's own checks as a second layer.

## How it works

1. **Row-level security (RLS).** Every table that holds tenant data has RLS *enabled and forced*
   with one policy: a row is visible/writable only if its `organizationId` equals the
   transaction's `app.organization_id` setting. Child tables without their own `organizationId`
   (`Message`, `OrderItem`, `PriceTier`, `ReturnItem`, `ShipmentItem`) are visible only if their
   parent is. With no setting the policies match nothing — a query that forgets to say which
   organization it's for sees **no rows** (fails closed).
2. **The tenant client.** `src/lib/db.ts` is the only way application code reaches tenant data:
   `tenantDb(organizationId)` for single queries and `transaction(organizationId, fn)` for
   interactive transactions. Both run `set_config('app.organization_id', …, true)` on the same
   connection before the query, so the setting is per-transaction and can't leak between requests
   on a pooled connection.
3. **A restricted database role.** Postgres skips RLS entirely for superusers and roles with
   `BYPASSRLS`. The app must therefore connect as `wholesale_app` (no superuser, no `BYPASSRLS`),
   while migrations and the seed run as the database owner:

   | variable | role | used for |
   |---|---|---|
   | `DATABASE_URL` | `wholesale_app` | the running app |
   | `DIRECT_URL` | owner | `prisma migrate`, the seed |

   `docker compose up -d db` creates the role (`docker/init-app-role.sql`). On any other Postgres,
   the migration creates it without a login — run
   `ALTER ROLE wholesale_app WITH LOGIN PASSWORD '<secret>';` once.
4. **Memberships.** A user belongs to one or more organizations through `Membership`, with a
   *role per organization*. The session's active organization and role are re-read from
   `Membership` on every request, so removing someone or changing their role takes effect on their
   next request, and a user can only ever switch to an organization they hold.

## What is *not* tenant-scoped

`User`, `Membership` and `Organization` are the identity/tenant registry: login must read them
before any tenant is known. They carry no tenant data. They are reached through the root client
(`prisma` in `src/lib/prisma.ts`); every other table must go through `tenantDb()`/`transaction()`.

## Guard rails

- `tests/isolation.test.ts` talks to Postgres as the restricted role and proves the database
  refuses cross-tenant reads, writes, moves and child-row attachments; that every table holding
  tenant data has forced RLS and a policy (a new table can't be forgotten); and — as a source
  scan — that no application file uses the root client on a tenant model.
- The whole test suite runs its application queries as the restricted role
  (`TENANT_DATABASE_URL`), with fixtures written by the owner, so every domain test also
  exercises RLS.
- `npm run db:check-isolation` reports whether the connection in `DATABASE_URL` is subject to RLS.
  The server runs the same check at startup (`src/instrumentation.ts`) and, in production,
  **refuses to start** if isolation isn't in force (override only knowingly, with
  `ALLOW_UNENFORCED_ISOLATION=true`).

## Adding a table

1. Give it an `organizationId` column (or, for a child table, a foreign key to a tenant parent).
2. In the migration, `ENABLE` and `FORCE` row-level security and add the policy — copy the pattern in
   `prisma/migrations/*_memberships_and_rls`. (Child tables: copy one of the `EXISTS` policies.)
3. Use it only through `tenantDb()`/`transaction()`.

The coverage test fails until step 2 is done.

## WhatsApp webhooks

Inbound messages are routed to the organization that registered the receiving number
(`Organization.whatsappPhoneNumberId`, matched against Meta's `metadata.phone_number_id`). A
message that can't be attributed to exactly one organization is not stored. A single-organization
install that hasn't registered a number is still routed to its one organization.
