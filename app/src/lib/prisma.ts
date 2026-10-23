import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; tenantRoot?: PrismaClient };

/**
 * The ROOT client: no tenant context. Use it only for the identity/tenant
 * registry (User, Membership, Organization) — tenant tables are protected by
 * row-level security, so through this client they appear empty. Everything that
 * touches tenant data goes through `tenantDb(organizationId)` / `transaction()`
 * in `src/lib/db.ts` (tests/isolation.test.ts enforces that).
 */
export const prisma = globalForPrisma.prisma ?? new PrismaClient();

/**
 * The connection tenant queries use. Normally the same as the root client; setting
 * TENANT_DATABASE_URL gives tenant queries their own connection — the tests use
 * this to run the application's queries as the restricted role while fixtures are
 * written by the owner.
 */
export const tenantRoot: PrismaClient = process.env.TENANT_DATABASE_URL
  ? (globalForPrisma.tenantRoot ??= new PrismaClient({ datasources: { db: { url: process.env.TENANT_DATABASE_URL } } }))
  : prisma;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
