import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StockMovementReason } from "@prisma/client";
import { phoneKeyOf } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { recordStockMovement, getProductStock, InsufficientStockError } from "@/lib/stock";
import {
  createDraftOrder,
  addOrderItem,
  confirmOrder,
  markOrderPaid,
  markOrderFulfilled,
  cancelOrder,
  OrderStateError,
} from "@/lib/orders";

describe("order lifecycle", () => {
  let organizationId: string;
  let userId: string;
  let customerId: string;
  let productA: string;
  let productB: string;
  let productTiered: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "Order Test Org" } });
    organizationId = org.id;

    const user = await prisma.user.create({
      data: { memberships: { create: { organizationId, role: "STAFF" } }, email: "order-test@example.com", passwordHash: "x", name: "Test Staff" },
    });
    userId = user.id;

    const customer = await prisma.customer.create({
      data: { organizationId, phone: "+10000000000", phoneKey: phoneKeyOf("+10000000000")!, name: "Test Customer" },
    });
    customerId = customer.id;

    const pA = await prisma.product.create({
      data: { organizationId, sku: "ORD-TEST-A", name: "Product A", priceCents: 10000 },
    });
    productA = pA.id;
    await recordStockMovement({
      organizationId,
      productId: productA,
      quantityDelta: 5,
      reason: StockMovementReason.INITIAL_STOCK,
    });

    const pB = await prisma.product.create({
      data: { organizationId, sku: "ORD-TEST-B", name: "Product B", priceCents: 25000 },
    });
    productB = pB.id;
    await recordStockMovement({
      organizationId,
      productId: productB,
      quantityDelta: 1,
      reason: StockMovementReason.INITIAL_STOCK,
    });

    const pTiered = await prisma.product.create({
      data: {
        organizationId,
        sku: "ORD-TEST-TIERED",
        name: "Tiered Product",
        priceCents: 20000,
        moq: 5,
        priceTiers: {
          create: [
            { minQuantity: 10, priceCents: 17000 },
            { minQuantity: 50, priceCents: 15000 },
          ],
        },
      },
    });
    productTiered = pTiered.id;
    await recordStockMovement({
      organizationId,
      productId: productTiered,
      quantityDelta: 100,
      reason: StockMovementReason.INITIAL_STOCK,
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("locks item prices at draft creation, independent of later catalogue price changes", async () => {
    const order = await createDraftOrder({
      organizationId,
      customerId,
      createdById: userId,
      items: [{ productId: productA, quantity: 2 }],
    });
    expect(order.totalCents).toBe(20000);

    await prisma.product.update({ where: { id: productA }, data: { priceCents: 99999 } });

    const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    expect(items[0].unitPriceCents).toBe(10000);

    await prisma.product.update({ where: { id: productA }, data: { priceCents: 10000 } });
  });

  it("does not touch stock while an order is still a draft", async () => {
    const before = await getProductStock(productA, prisma);
    await createDraftOrder({
      organizationId,
      customerId,
      createdById: userId,
      items: [{ productId: productA, quantity: 3 }],
    });
    expect(await getProductStock(productA, prisma)).toBe(before);
  });

  it("reserves stock atomically on confirm — all items or none", async () => {
    // productB has only 1 unit; asking for 2 of it must fail the whole
    // confirmation, including not partially reserving productA.
    const order = await createDraftOrder({
      organizationId,
      customerId,
      createdById: userId,
      items: [
        { productId: productA, quantity: 1 },
        { productId: productB, quantity: 2 },
      ],
    });

    const stockABefore = await getProductStock(productA, prisma);
    const stockBBefore = await getProductStock(productB, prisma);

    await expect(
      confirmOrder({ organizationId, orderId: order.id, actorId: userId, allowDuplicate: true })
    ).rejects.toBeInstanceOf(InsufficientStockError);

    expect(await getProductStock(productA, prisma)).toBe(stockABefore);
    expect(await getProductStock(productB, prisma)).toBe(stockBBefore);

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe("DRAFT");
  });

  it("moves draft -> confirmed -> paid -> fulfilled, reserving and never releasing stock along the way", async () => {
    const stockBefore = await getProductStock(productA, prisma);
    const order = await createDraftOrder({
      organizationId,
      customerId,
      createdById: userId,
      items: [{ productId: productA, quantity: 1 }],
    });

    await confirmOrder({ organizationId, orderId: order.id, actorId: userId, allowDuplicate: true });
    expect(await getProductStock(productA, prisma)).toBe(stockBefore - 1);

    await markOrderPaid({ organizationId, orderId: order.id, actorId: userId });
    await markOrderFulfilled({ organizationId, orderId: order.id, actorId: userId });

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe("FULFILLED");
    expect(reloaded.confirmedAt).not.toBeNull();
    expect(reloaded.paidAt).not.toBeNull();
    expect(reloaded.fulfilledAt).not.toBeNull();
    // Stock was only ever decremented once, at confirmation.
    expect(await getProductStock(productA, prisma)).toBe(stockBefore - 1);
  });

  it("rejects out-of-order transitions", async () => {
    const order = await createDraftOrder({
      organizationId,
      customerId,
      createdById: userId,
      items: [{ productId: productA, quantity: 1 }],
    });

    await expect(
      markOrderPaid({ organizationId, orderId: order.id, actorId: userId })
    ).rejects.toBeInstanceOf(OrderStateError);
    await expect(
      markOrderFulfilled({ organizationId, orderId: order.id, actorId: userId })
    ).rejects.toBeInstanceOf(OrderStateError);
  });

  it("releases reserved stock when a confirmed order is cancelled", async () => {
    const stockBefore = await getProductStock(productA, prisma);
    const order = await createDraftOrder({
      organizationId,
      customerId,
      createdById: userId,
      items: [{ productId: productA, quantity: 1 }],
    });

    await confirmOrder({ organizationId, orderId: order.id, actorId: userId, allowDuplicate: true });
    expect(await getProductStock(productA, prisma)).toBe(stockBefore - 1);

    await cancelOrder({ organizationId, orderId: order.id, actorId: userId });
    expect(await getProductStock(productA, prisma)).toBe(stockBefore);

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe("CANCELLED");
  });

  it("refuses to cancel a fulfilled order", async () => {
    const order = await createDraftOrder({
      organizationId,
      customerId,
      createdById: userId,
      items: [{ productId: productA, quantity: 1 }],
    });
    await confirmOrder({ organizationId, orderId: order.id, actorId: userId, allowDuplicate: true });
    await markOrderPaid({ organizationId, orderId: order.id, actorId: userId });
    await markOrderFulfilled({ organizationId, orderId: order.id, actorId: userId });

    await expect(
      cancelOrder({ organizationId, orderId: order.id, actorId: userId })
    ).rejects.toBeInstanceOf(OrderStateError);
  });

  it("rejects an order item below the product's minimum order quantity", async () => {
    await expect(
      createDraftOrder({
        organizationId,
        customerId,
        createdById: userId,
        items: [{ productId: productTiered, quantity: 2 }], // moq is 5
      })
    ).rejects.toBeInstanceOf(OrderStateError);
  });

  it("enforces MOQ when adding an item to an existing draft too", async () => {
    const order = await createDraftOrder({
      organizationId,
      customerId,
      createdById: userId,
      items: [{ productId: productA, quantity: 1 }],
    });

    await expect(
      addOrderItem({ organizationId, orderId: order.id, productId: productTiered, quantity: 3 })
    ).rejects.toBeInstanceOf(OrderStateError);
  });

  it("prices items using the highest qualifying quantity-break tier", async () => {
    const belowAnyTier = await createDraftOrder({
      organizationId,
      customerId,
      createdById: userId,
      items: [{ productId: productTiered, quantity: 5 }], // meets moq, below the 10-unit tier
    });
    expect(belowAnyTier.items[0].unitPriceCents).toBe(20000); // base price

    const midTier = await createDraftOrder({
      organizationId,
      customerId,
      createdById: userId,
      items: [{ productId: productTiered, quantity: 10 }],
    });
    expect(midTier.items[0].unitPriceCents).toBe(17000);

    const topTier = await createDraftOrder({
      organizationId,
      customerId,
      createdById: userId,
      items: [{ productId: productTiered, quantity: 50 }],
    });
    expect(topTier.items[0].unitPriceCents).toBe(15000);
    expect(topTier.totalCents).toBe(50 * 15000);
  });

  it("locks the tiered price at the moment an item is added — a later quantity change needs removing and re-adding", async () => {
    const order = await createDraftOrder({
      organizationId,
      customerId,
      createdById: userId,
      items: [{ productId: productA, quantity: 1 }],
    });
    await addOrderItem({ organizationId, orderId: order.id, productId: productTiered, quantity: 10 });

    const items = await prisma.orderItem.findMany({ where: { orderId: order.id, productId: productTiered } });
    expect(items[0].unitPriceCents).toBe(17000);
  });
});
