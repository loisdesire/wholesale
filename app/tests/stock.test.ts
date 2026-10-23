import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StockMovementReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { InsufficientStockError, getProductStock, recordStockMovement } from "@/lib/stock";

describe("stock ledger", () => {
  let organizationId: string;
  let productId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    organizationId = org.id;

    const product = await prisma.product.create({
      data: { organizationId, sku: "TEST-SKU-1", name: "Test Product", priceCents: 100000 },
    });
    productId = product.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("increases stock on a purchase-received movement", async () => {
    await recordStockMovement({
      organizationId,
      productId,
      quantityDelta: 10,
      reason: StockMovementReason.PURCHASE_RECEIVED,
    });

    expect(await getProductStock(productId, prisma)).toBe(10);
  });

  it("rejects a movement that would drive stock negative, and records nothing", async () => {
    const before = await getProductStock(productId, prisma);

    await expect(
      recordStockMovement({
        organizationId,
        productId,
        quantityDelta: -(before + 1),
        reason: StockMovementReason.MANUAL_ADJUSTMENT,
      })
    ).rejects.toBeInstanceOf(InsufficientStockError);

    expect(await getProductStock(productId, prisma)).toBe(before);
  });

  it("current stock always equals the sum of recorded movements", async () => {
    await recordStockMovement({
      organizationId,
      productId,
      quantityDelta: -3,
      reason: StockMovementReason.DAMAGE,
    });
    await recordStockMovement({
      organizationId,
      productId,
      quantityDelta: 2,
      reason: StockMovementReason.RETURN,
    });

    const movements = await prisma.stockMovement.findMany({ where: { productId } });
    const sum = movements.reduce((total, m) => total + m.physicalDelta - m.reservedDelta - m.damagedDelta, 0);
    expect(await getProductStock(productId, prisma)).toBe(sum);
  });

  it("never oversells under concurrent fulfilment of the last unit", async () => {
    const lastUnitProduct = await prisma.product.create({
      data: {
        organizationId,
        sku: "TEST-SKU-LAST-UNIT",
        name: "Last Unit Product",
        priceCents: 50000,
      },
    });
    await recordStockMovement({
      organizationId,
      productId: lastUnitProduct.id,
      quantityDelta: 1,
      reason: StockMovementReason.INITIAL_STOCK,
    });

    const attempts = await Promise.allSettled([
      recordStockMovement({
        organizationId,
        productId: lastUnitProduct.id,
        quantityDelta: -1,
        reason: StockMovementReason.SALE_RESERVED,
      }),
      recordStockMovement({
        organizationId,
        productId: lastUnitProduct.id,
        quantityDelta: -1,
        reason: StockMovementReason.SALE_RESERVED,
      }),
    ]);

    const fulfilled = attempts.filter((a) => a.status === "fulfilled");
    const rejected = attempts.filter((a) => a.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientStockError);

    // Never negative — exactly one sale went through against the one unit.
    expect(await getProductStock(lastUnitProduct.id, prisma)).toBe(0);
  });

  it("admits exactly as many concurrent reservations as there is stock for (real Postgres connections)", async () => {
    const product = await prisma.product.create({
      data: { organizationId, sku: "TEST-SKU-STRESS", name: "Stress Product", priceCents: 10000 },
    });
    await recordStockMovement({
      organizationId,
      productId: product.id,
      quantityDelta: 3,
      reason: StockMovementReason.INITIAL_STOCK,
    });

    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        recordStockMovement({
          organizationId,
          productId: product.id,
          quantityDelta: -1,
          reason: StockMovementReason.SALE_RESERVED,
        })
      )
    );

    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(3);
    for (const a of attempts.filter((a) => a.status === "rejected")) {
      expect((a as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientStockError);
    }
    expect(await getProductStock(product.id, prisma)).toBe(0);
  });
});
