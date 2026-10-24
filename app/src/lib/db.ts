import type { Prisma, PrismaClient } from "@prisma/client";
import { tenantRoot } from "@/lib/prisma";

/**
 * Tenant-scoped database access.
 *
 * Postgres row-level security hides every row whose organizationId doesn't match
 * the transaction's `app.organization_id` setting. These helpers are how that
 * setting gets there: each query (or interactive transaction) first runs
 * `set_config('app.organization_id', <org>, true)` on the same connection, so the
 * database itself — not just a `where` clause somebody has to remember —
 * guarantees one organization can't read or write another's data. A query that
 * forgets to say which organization it is for sees no rows at all (fails closed).
 *
 * `userScopedDb` extends the same idea one level down, for the handful of tables
 * (notifications) whose rows also belong to a specific *person* within the
 * organization, not just the organization as a whole.
 */

/** The model API a query helper needs; satisfied by a transaction client and by tenantDb(). */
export type DbClient = Prisma.TransactionClient;

function scoped(client: PrismaClient, organizationId: string): DbClient {
  const extended = client.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await client.$transaction([
            client.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`,
            query(args) as Prisma.PrismaPromise<unknown>,
          ]);
          return result;
        },
      },
    },
  });
  // The extended client exposes the same model delegates as a transaction client;
  // it just doesn't offer $transaction/$connect, which tenant code must not call on it.
  return extended as unknown as DbClient;
}

const cache = new Map<string, DbClient>();

/** A client whose every query is confined to one organization. */
export function tenantDb(organizationId: string): DbClient {
  if (!organizationId) throw new Error("tenantDb needs an organization id.");
  let db = cache.get(organizationId);
  if (!db) {
    if (cache.size > 1000) cache.clear();
    db = scoped(tenantRoot, organizationId);
    cache.set(organizationId, db);
  }
  return db;
}

function userScoped(client: PrismaClient, organizationId: string, userId: string): DbClient {
  const extended = client.$extends({
    name: "user-scope",
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, , result] = await client.$transaction([
            client.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`,
            client.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`,
            query(args) as Prisma.PrismaPromise<unknown>,
          ]);
          return result;
        },
      },
    },
  });
  return extended as unknown as DbClient;
}

const userCache = new Map<string, DbClient>();

/**
 * A client confined to one organization *and* one user — for tables (today, just
 * `Notification`) whose row-level security also checks `app.user_id`, so a forgotten
 * `where userId` can't leak one person's rows to another member of the same
 * organization. Writing a notification *for* someone else still goes through the
 * ordinary org-scoped `transaction()` (see `notify()` in `src/lib/notifications.ts`) —
 * only reading or marking your own notifications needs this.
 */
export function userScopedDb(organizationId: string, userId: string): DbClient {
  if (!organizationId) throw new Error("userScopedDb needs an organization id.");
  if (!userId) throw new Error("userScopedDb needs a user id.");
  const key = `${organizationId}:${userId}`;
  let db = userCache.get(key);
  if (!db) {
    if (userCache.size > 1000) userCache.clear();
    db = userScoped(tenantRoot, organizationId, userId);
    userCache.set(key, db);
  }
  return db;
}

/**
 * Runs `fn` in one transaction confined to one organization. Every interactive
 * transaction in the domain layer goes through here.
 */
export function transaction<T>(organizationId: string, fn: (tx: DbClient) => Promise<T>): Promise<T> {
  if (!organizationId) throw new Error("transaction needs an organization id.");
  return tenantRoot.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
    return fn(tx);
  });
}
