import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Runs `fn` in a transaction for one organization. Every interactive
 * transaction in the domain layer goes through here so the tenant boundary can
 * be enforced in a single place (see the tenant-isolation work).
 */
export function transaction<T>(
  organizationId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  void organizationId;
  return prisma.$transaction(fn);
}
