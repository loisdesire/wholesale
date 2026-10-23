import type { Prisma, StockMovementReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export class InsufficientStockError extends Error {
  constructor(
    public readonly available: number,
    public readonly requested: number,
    public readonly productName?: string
  ) {
    super(
      productName
        ? `Only ${available} of "${productName}" in stock, cannot remove ${requested}.`
        : `Only ${available} in stock, cannot remove ${requested}.`
    );
    this.name = "InsufficientStockError";
  }
}

type TxClient = Prisma.TransactionClient;

export async function getProductStock(productId: string, client: TxClient | typeof prisma = prisma) {
  const result = await client.stockMovement.aggregate({
    where: { productId },
    _sum: { quantityDelta: true },
  });
  return result._sum.quantityDelta ?? 0;
}

export async function getStockByProduct(organizationId: string, client: TxClient | typeof prisma = prisma) {
  const rows = await client.stockMovement.groupBy({
    by: ["productId"],
    where: { organizationId },
    _sum: { quantityDelta: true },
  });
  return new Map(rows.map((r) => [r.productId, r._sum.quantityDelta ?? 0]));
}

type RecordMovementParams = {
  organizationId: string;
  productId: string;
  quantityDelta: number;
  reason: StockMovementReason;
  reference?: string;
  note?: string;
  createdById?: string;
};

/**
 * Core of recordStockMovement, factored out so callers that need to reserve
 * stock for *several* products atomically (e.g. confirming a multi-item
 * order) can run this once per item inside their own outer transaction,
 * instead of each item getting its own isolated transaction that could
 * partially succeed if a later item fails.
 */
export async function recordStockMovementTx(tx: TxClient, params: RecordMovementParams) {
  if (params.quantityDelta === 0) {
    throw new Error("Stock movement quantity cannot be zero.");
  }

  const current = await getProductStock(params.productId, tx);
  const next = current + params.quantityDelta;
  if (next < 0) {
    const product = await tx.product.findUnique({ where: { id: params.productId } });
    throw new InsufficientStockError(current, -params.quantityDelta, product?.name);
  }

  return tx.stockMovement.create({
    data: {
      organizationId: params.organizationId,
      productId: params.productId,
      quantityDelta: params.quantityDelta,
      reason: params.reason,
      reference: params.reference,
      note: params.note,
      createdById: params.createdById,
    },
  });
}

/**
 * Records a single stock movement, rejecting it atomically if it would drive
 * stock negative. The read-then-write happens inside one transaction so two
 * concurrent calls against the same product can't both succeed against stock
 * that only covers one of them — see tests/stock.test.ts for the race case.
 *
 * SQLite (dev) serializes writes via a single connection (DATABASE_URL has
 * connection_limit=1), which makes this safe today. On Postgres, upgrade this
 * to `{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }` (or
 * a `SELECT ... FOR UPDATE` on the product row) before relying on it under
 * real concurrent load.
 */
export async function recordStockMovement(params: RecordMovementParams) {
  return prisma.$transaction((tx) => recordStockMovementTx(tx, params));
}
