import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StockMovementReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  InsufficientStockError,
  StockInvariantError,
  getStockBreakdown,
  recordStockMovement,
} from "@/lib/stock";
import { movementEffects } from "@/lib/stock-effects";
import { confirmOrder, createDraftOrder, markOrderFulfilled, markOrderPaid, cancelOrder } from "@/lib/orders";

describe("movementEffects", () => {
  it("maps each reason onto physical / reserved / damaged", () => {
    expect(movementEffects("PURCHASE_RECEIVED", 10)).toEqual({ physicalDelta: 10, reservedDelta: 0, damagedDelta: 0 });
    expect(movementEffects("SALE_RESERVED", -4)).toEqual({ physicalDelta: 0, reservedDelta: 4, damagedDelta: 0 });
    expect(movementEffects("RESERVATION_RELEASED", 4)).toEqual({ physicalDelta: 0, reservedDelta: -4, damagedDelta: 0 });
    expect(movementEffects("SALE_FULFILLED", -4)).toEqual({ physicalDelta: -4, reservedDelta: -4, damagedDelta: 0 });
    expect(movementEffects("DAMAGE", -2)).toEqual({ physicalDelta: 0, reservedDelta: 0, damagedDelta: 2 });
    expect(movementEffects("DAMAGE_WRITTEN_OFF", -2)).toEqual({ physicalDelta: -2, reservedDelta: 0, damagedDelta: -2 });
    expect(movementEffects("RETURN_DAMAGED", 3)).toEqual({ physicalDelta: 3, reservedDelta: 0, damagedDelta: 3 });
  });

  it("keeps available = physical - reserved - damaged consistent with the available change callers expect", () => {
    // Reserving N takes N out of available; releasing gives it back.
    for (const [reason, q, availableChange] of [
      ["SALE_RESERVED", -4, -4],
      ["RESERVATION_RELEASED", 4, 4],
      ["SALE_FULFILLED", -4, 0], // already out of availability since confirmation
      ["DAMAGE", -2, -2],
      ["DAMAGE_WRITTEN_OFF", -2, 0], // already out of availability since being set aside
      ["RETURN", 3, 3],
      ["RETURN_DAMAGED", 3, 0],
    ] as const) {
      const fx = movementEffects(reason, q);
      expect(fx.physicalDelta - fx.reservedDelta - fx.damagedDelta).toBe(availableChange);
    }
  });

  it("rejects zero, fractional and wrong-signed quantities", () => {
    expect(() => movementEffects("PURCHASE_RECEIVED", 0)).toThrow();
    expect(() => movementEffects("PURCHASE_RECEIVED", 1.5)).toThrow();
    expect(() => movementEffects("PURCHASE_RECEIVED", -1)).toThrow(/must be positive/);
    expect(() => movementEffects("SALE_RESERVED", 1)).toThrow(/must be negative/);
    expect(() => movementEffects("DAMAGE", 1)).toThrow(/must be negative/);
  });
});

describe("physical / reserved / available / damaged stock", () => {
  let organizationId: string;
  let otherOrganizationId: string;
  let userId: string;
  let customerId: string;
  let n = 0;

  beforeAll(async () => {
    organizationId = (await prisma.organization.create({ data: { name: "Figures Org" } })).id;
    otherOrganizationId = (await prisma.organization.create({ data: { name: "Other Org" } })).id;
    userId = (
      await prisma.user.create({
        data: { organizationId, email: "figures@example.com", passwordHash: "x", name: "Figures Staff" },
      })
    ).id;
    customerId = (await prisma.customer.create({ data: { organizationId, phone: "+19990000001" } })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function productWithStock(units: number) {
    n += 1;
    const product = await prisma.product.create({
      data: { organizationId, sku: `FIG-${n}`, name: `Figures Product ${n}`, priceCents: 10000 },
    });
    if (units > 0) {
      await recordStockMovement({
        organizationId,
        productId: product.id,
        quantityDelta: units,
        reason: StockMovementReason.INITIAL_STOCK,
      });
    }
    return product.id;
  }

  const move = (productId: string, reason: StockMovementReason, quantityDelta: number) =>
    recordStockMovement({ organizationId, productId, reason, quantityDelta });

  it("walks a unit through reserve -> ship, keeping the four figures consistent", async () => {
    const productId = await productWithStock(10);
    expect(await getStockBreakdown(productId)).toEqual({ physical: 10, reserved: 0, damaged: 0, available: 10 });

    const order = await createDraftOrder({
      organizationId,
      customerId,
      createdById: userId,
      items: [{ productId, quantity: 4 }],
    });
    // A draft is a non-binding quote: nothing moves.
    expect(await getStockBreakdown(productId)).toEqual({ physical: 10, reserved: 0, damaged: 0, available: 10 });

    await confirmOrder({ organizationId, orderId: order.id, actorId: userId });
    expect(await getStockBreakdown(productId)).toEqual({ physical: 10, reserved: 4, damaged: 0, available: 6 });

    await markOrderPaid({ organizationId, orderId: order.id, actorId: userId });
    await markOrderFulfilled({ organizationId, orderId: order.id, actorId: userId });
    expect(await getStockBreakdown(productId)).toEqual({ physical: 6, reserved: 0, damaged: 0, available: 6 });
  });

  it("cancelling a confirmed order returns the units to available without touching physical", async () => {
    const productId = await productWithStock(5);
    const order = await createDraftOrder({
      organizationId,
      customerId,
      createdById: userId,
      items: [{ productId, quantity: 3 }],
    });
    await confirmOrder({ organizationId, orderId: order.id, actorId: userId });
    await cancelOrder({ organizationId, orderId: order.id, actorId: userId });
    expect(await getStockBreakdown(productId)).toEqual({ physical: 5, reserved: 0, damaged: 0, available: 5 });
  });

  it("a manual removal cannot eat into stock that is reserved for a confirmed order", async () => {
    const productId = await productWithStock(5);
    const order = await createDraftOrder({
      organizationId,
      customerId,
      createdById: userId,
      items: [{ productId, quantity: 4 }],
    });
    await confirmOrder({ organizationId, orderId: order.id, actorId: userId });

    // 5 on the shelf, but only 1 is actually available to take out.
    await expect(move(productId, "MANUAL_ADJUSTMENT", -2)).rejects.toBeInstanceOf(InsufficientStockError);
    await move(productId, "MANUAL_ADJUSTMENT", -1);
    expect(await getStockBreakdown(productId)).toEqual({ physical: 4, reserved: 4, damaged: 0, available: 0 });
  });

  it("damaged stock leaves availability, stays on hand, and can then be written off", async () => {
    const productId = await productWithStock(10);
    await move(productId, "DAMAGE", -3);
    expect(await getStockBreakdown(productId)).toEqual({ physical: 10, reserved: 0, damaged: 3, available: 7 });

    await move(productId, "DAMAGE_WRITTEN_OFF", -2);
    expect(await getStockBreakdown(productId)).toEqual({ physical: 8, reserved: 0, damaged: 1, available: 7 });
  });

  it("cannot write off more damaged units than are on record, or set aside more than is available", async () => {
    const productId = await productWithStock(4);
    await expect(move(productId, "DAMAGE_WRITTEN_OFF", -1)).rejects.toBeInstanceOf(StockInvariantError);
    await expect(move(productId, "DAMAGE", -5)).rejects.toBeInstanceOf(InsufficientStockError);
    expect(await getStockBreakdown(productId)).toEqual({ physical: 4, reserved: 0, damaged: 0, available: 4 });
  });

  it("cannot ship or release more than is reserved", async () => {
    const productId = await productWithStock(4);
    await expect(move(productId, "SALE_FULFILLED", -1)).rejects.toBeInstanceOf(StockInvariantError);
    await expect(move(productId, "RESERVATION_RELEASED", 1)).rejects.toBeInstanceOf(StockInvariantError);
  });

  it("a damaged return goes on hand but never into available", async () => {
    const productId = await productWithStock(2);
    await move(productId, "RETURN_DAMAGED", 3);
    expect(await getStockBreakdown(productId)).toEqual({ physical: 5, reserved: 0, damaged: 3, available: 2 });
  });

  it("refuses to move stock for a product that belongs to another organization", async () => {
    const productId = await productWithStock(5);
    await expect(
      recordStockMovement({
        organizationId: otherOrganizationId,
        productId,
        quantityDelta: -1,
        reason: StockMovementReason.MANUAL_ADJUSTMENT,
      })
    ).rejects.toBeInstanceOf(StockInvariantError);
    expect(await getStockBreakdown(productId)).toMatchObject({ physical: 5 });
  });

  it("two orders confirming the same products in opposite item order do not deadlock", async () => {
    const a = await productWithStock(50);
    const b = await productWithStock(50);
    const make = (items: { productId: string; quantity: number }[]) =>
      createDraftOrder({ organizationId, customerId, createdById: userId, items });

    const orders = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        make(i % 2 === 0 ? [{ productId: a, quantity: 1 }, { productId: b, quantity: 1 }] : [{ productId: b, quantity: 1 }, { productId: a, quantity: 1 }])
      )
    );
    const results = await Promise.allSettled(
      orders.map((o) => confirmOrder({ organizationId, orderId: o.id, actorId: userId }))
    );
    expect(results.map((r) => r.status)).toEqual(Array(6).fill("fulfilled"));
    expect(await getStockBreakdown(a)).toMatchObject({ reserved: 6, available: 44 });
    expect(await getStockBreakdown(b)).toMatchObject({ reserved: 6, available: 44 });
  });

  it("concurrent confirmations never reserve more than is available across a multi-item order", async () => {
    const scarce = await productWithStock(2);
    const plenty = await productWithStock(100);
    const orders = await Promise.all(
      Array.from({ length: 5 }, () =>
        createDraftOrder({
          organizationId,
          customerId,
          createdById: userId,
          items: [
            { productId: plenty, quantity: 1 },
            { productId: scarce, quantity: 1 },
          ],
        })
      )
    );
    const results = await Promise.allSettled(
      orders.map((o) => confirmOrder({ organizationId, orderId: o.id, actorId: userId }))
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    // All-or-nothing: the rejected orders reserved none of the plentiful item either.
    expect(await getStockBreakdown(scarce)).toMatchObject({ reserved: 2, available: 0 });
    expect(await getStockBreakdown(plenty)).toMatchObject({ reserved: 2, available: 98 });
  });
});
