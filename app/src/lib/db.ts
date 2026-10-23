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
