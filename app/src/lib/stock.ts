import type { Prisma, StockMovementReason } from "@prisma/client";
import { transaction, type DbClient } from "@/lib/db";
import { EMPTY_FIGURES, movementEffects, toFigures, type StockFigures } from "@/lib/stock-effects";

export type { StockFigures } from "@/lib/stock-effects";

export class InsufficientStockError extends Error {
  constructor(
    public readonly available: number,
    public readonly requested: number,
    public readonly productName?: string
  ) {
    super(
      productName
        ? `Only ${available} of "${productName}" available, cannot remove ${requested}.`
        : `Only ${available} available, cannot remove ${requested}.`
    );
    this.name = "InsufficientStockError";
  }
}

/** A movement that would make reserved or damaged stock negative (e.g. shipping more than was reserved). */
export class StockInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockInvariantError";
  }
}

type TxClient = Prisma.TransactionClient;
type Client = DbClient;

const SUMS = { physicalDelta: true, reservedDelta: true, damagedDelta: true } as const;

type DeltaSums = { physicalDelta: number | null; reservedDelta: number | null; damagedDelta: number | null };

function figuresFrom(sum: DeltaSums | null | undefined): StockFigures {
  if (!sum) return EMPTY_FIGURES;
  return toFigures({
    physical: sum.physicalDelta ?? 0,
    reserved: sum.reservedDelta ?? 0,
    damaged: sum.damagedDelta ?? 0,
  });
}

/** Physical / reserved / damaged / available for one product, summed from the ledger. */
export async function getStockBreakdown(productId: string, client: Client): Promise<StockFigures> {
  const result = await client.stockMovement.aggregate({ where: { productId }, _sum: SUMS });
  return figuresFrom(result._sum);
}

/** Units that can still be promised to a customer (physical - reserved - damaged). */
export async function getProductStock(productId: string, client: Client) {
  return (await getStockBreakdown(productId, client)).available;
}

/** Full breakdown for many products at once. Pass `productIds` to bound the query. */
export async function getStockBreakdownByProduct(
  organizationId: string,
  options: { productIds?: string[] } = {},
  client: Client
) {
  const rows = await client.stockMovement.groupBy({
    by: ["productId"],
    where: {
      organizationId,
      ...(options.productIds ? { productId: { in: options.productIds } } : {}),
    },
    _sum: SUMS,
  });
  return new Map(rows.map((r) => [r.productId, figuresFrom(r._sum)]));
}

/** Available stock per product (what can still be sold). */
export async function getStockByProduct(organizationId: string, client: Client) {
  const breakdown = await getStockBreakdownByProduct(organizationId, {}, client);
  return new Map([...breakdown].map(([productId, figures]) => [productId, figures.available]));
}

type RecordMovementParams = {
  organizationId: string;
  productId: string;
  /** Signed quantity; what it is measured in depends on `reason` — see stock-effects.ts. */
  quantityDelta: number;
  reason: StockMovementReason;
  reference?: string;
  note?: string;
  createdById?: string;
};

/**
 * Core of recordStockMovement, factored out so callers that need to move
 * stock for *several* products atomically (e.g. confirming a multi-item
 * order) can run this once per item inside their own outer transaction,
 * instead of each item getting its own isolated transaction that could
 * partially succeed if a later item fails.
 *
 * Concurrency: the product row is locked (SELECT ... FOR UPDATE) before the
 * ledger is read, so concurrent movements for one product run one at a time
 * and each sees the previous one's result. Without the lock, Postgres'
 * default READ COMMITTED isolation lets many transactions all read "3 left"
 * and all succeed (tests/stock.test.ts reproduces this). Callers touching
 * several products should do so in a consistent order (see
 * `sortByProductId`) so two transactions can't lock them in opposite orders.
 */
export async function recordStockMovementTx(tx: TxClient, params: RecordMovementParams) {
  const effects = movementEffects(params.reason, params.quantityDelta);

  const locked = await tx.$queryRaw<{ name: string }[]>`
    SELECT "name" FROM "Product"
    WHERE "id" = ${params.productId} AND "organizationId" = ${params.organizationId}
    FOR UPDATE`;
  if (locked.length === 0) {
    throw new StockInvariantError("Product not found.");
  }

  const before = await getStockBreakdown(params.productId, tx);
  const after = toFigures({
    physical: before.physical + effects.physicalDelta,
    reserved: before.reserved + effects.reservedDelta,
    damaged: before.damaged + effects.damagedDelta,
  });

  if (after.available < 0) {
    throw new InsufficientStockError(before.available, before.available - after.available, locked[0].name);
  }
  if (after.reserved < 0) {
    throw new StockInvariantError(`Cannot release or ship more than the ${before.reserved} reserved of "${locked[0].name}".`);
  }
  if (after.damaged < 0) {
    throw new StockInvariantError(`Only ${before.damaged} damaged unit(s) of "${locked[0].name}" on record.`);
  }

  return tx.stockMovement.create({
    data: {
      organizationId: params.organizationId,
      productId: params.productId,
      ...effects,
      reason: params.reason,
      reference: params.reference,
      note: params.note,
      createdById: params.createdById,
    },
  });
}

/**
 * Records a single stock movement, rejecting it atomically if it would drive
 * available, reserved or damaged stock negative. The lock-read-write happens
 * inside one transaction; see recordStockMovementTx for why the lock matters.
 */
export async function recordStockMovement(params: RecordMovementParams) {
  return transaction(params.organizationId, (tx) => recordStockMovementTx(tx, params));
}

/** Stable lock order for multi-product transactions (prevents deadlocks). */
export function sortByProductId<T extends { productId: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
}
