import type { Prisma } from "@prisma/client";

/**
 * Takes a row lock (SELECT ... FOR UPDATE) so concurrent transactions touching
 * the same record run one at a time, each seeing the previous one's result.
 * Needed because Postgres' default READ COMMITTED isolation otherwise lets two
 * requests both read "status = DRAFT" and both act on it. Table names are a
 * closed union, so interpolating one into the SQL is safe.
 */
export async function lockRow(
  tx: Prisma.TransactionClient,
  table: "Order" | "OrderReturn" | "Customer",
  id: string
) {
  await tx.$queryRawUnsafe(`SELECT "id" FROM "${table}" WHERE "id" = $1 FOR UPDATE`, id);
}
