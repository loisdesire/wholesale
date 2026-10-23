import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StockMovementReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { phoneKeyOf } from "@/lib/phone";
import { getStockBreakdown, recordStockMovement } from "@/lib/stock";
import {
  DuplicateOrderError,
  OrderStateError,
  cancelOrder,
  confirmOrder,
  createDraftOrder,
  findDuplicateOrders,
  markOrderFulfilled,
  markOrderPaid,
  updateOrderDetails,
  updateOrderItemQuantity,
} from "@/lib/orders";
import { ReturnPermissionError, markRefunded, receiveReturn, requestReturn } from "@/lib/returns";
import { getCustomerBalances } from "@/lib/balances";

describe("order depth: amendments, repeat protection, cancelling paid orders", () => {
  let organizationId: string;
  let otherOrganizationId: string;
  let ownerId: string;
  let staffId: string;
  let n = 0;

  beforeAll(async () => {
    organizationId = (await prisma.organization.create({ data: { name: "Order Depth Org" } })).id;
    otherOrganizationId = (await prisma.organization.create({ data: { name: "Other Depth Org" } })).id;
    ownerId = (
      await prisma.user.create({
        data: { organizationId, email: "depth-owner@example.com", passwordHash: "x", name: "Owner", role: "OWNER" },
      })
    ).id;
    staffId = (
      await prisma.user.create({
        data: { organizationId, email: "depth-staff@example.com", passwordHash: "x", name: "Staff", role: "STAFF" },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function customer() {
    n += 1;
    const phone = `+1777000${String(1000 + n)}`;
    return (await prisma.customer.create({ data: { organizationId, phone, phoneKey: phoneKeyOf(phone)!, name: `C${n}` } })).id;
  }

  async function product(stock: number, opts: { priceCents?: number; moq?: number; tiers?: { minQuantity: number; priceCents: number }[] } = {}) {
    n += 1;
    const p = await prisma.product.create({
      data: {
        organizationId,
        sku: `DEPTH-${n}`,
        name: `Depth Product ${n}`,
        priceCents: opts.priceCents ?? 10000,
        moq: opts.moq ?? 1,
        priceTiers: opts.tiers ? { create: opts.tiers } : undefined,
      },
    });
    if (stock > 0) {
      await recordStockMovement({ organizationId, productId: p.id, quantityDelta: stock, reason: StockMovementReason.INITIAL_STOCK });
    }
    return p.id;
  }

  const draft = (customerId: string, items: { productId: string; quantity: number }[], extra = {}) =>
    createDraftOrder({ organizationId, customerId, createdById: ownerId, items, ...extra });

  const args = (orderId: string, actorId = ownerId) => ({ organizationId, orderId, actorId });

  describe("changing a quantity after quoting", () => {
    it("re-prices the line at the new quantity's tier and updates the order total", async () => {
      const productId = await product(100, { tiers: [{ minQuantity: 10, priceCents: 8000 }] });
      const order = await draft(await customer(), [{ productId, quantity: 2 }]);
      expect(order.totalCents).toBe(2 * 10000);
      const itemId = order.items[0].id;

      await updateOrderItemQuantity({ ...args(order.id), orderItemId: itemId, quantity: 12 });
      let stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
      expect(stored.items[0]).toMatchObject({ quantity: 12, unitPriceCents: 8000 });
      expect(stored.totalCents).toBe(12 * 8000);

      // And back down: the tier no longer applies.
      await updateOrderItemQuantity({ ...args(order.id), orderItemId: itemId, quantity: 3 });
      stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
      expect(stored.items[0]).toMatchObject({ quantity: 3, unitPriceCents: 10000 });
      expect(stored.totalCents).toBe(30000);
    });

    it("audits the change with before and after values", async () => {
      const productId = await product(50);
      const order = await draft(await customer(), [{ productId, quantity: 2 }]);
      await updateOrderItemQuantity({ ...args(order.id, staffId), orderItemId: order.items[0].id, quantity: 5 });
      const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityId: order.id, action: "ORDER_ITEM_QUANTITY_CHANGED" } });
      expect(entry.actorId).toBe(staffId);
      expect(entry.before).toMatchObject({ quantity: 2, totalCents: 20000 });
      expect(entry.after).toMatchObject({ quantity: 5, totalCents: 50000 });
    });

    it("enforces MOQ, positive whole quantities, and draft-only", async () => {
      const productId = await product(100, { moq: 5 });
      const order = await draft(await customer(), [{ productId, quantity: 5 }]);
      const itemId = order.items[0].id;
      const change = (quantity: number) => updateOrderItemQuantity({ ...args(order.id), orderItemId: itemId, quantity });

      await expect(change(3)).rejects.toThrow(/minimum order quantity of 5/);
      await expect(change(0)).rejects.toThrow(/greater than zero/);
      await expect(change(-2)).rejects.toThrow(/greater than zero/);
      await expect(change(2.5)).rejects.toThrow(/whole number/);
      expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: itemId } })).quantity).toBe(5);

      await confirmOrder(args(order.id));
      await expect(change(8)).rejects.toThrow("Only draft orders can be changed.");
    });

    it("cannot reach another organization's order or a line from a different order", async () => {
      const productId = await product(50);
      const a = await draft(await customer(), [{ productId, quantity: 1 }]);
      const b = await draft(await customer(), [{ productId, quantity: 2 }]);
      await expect(
        updateOrderItemQuantity({ organizationId: otherOrganizationId, orderId: a.id, orderItemId: a.items[0].id, quantity: 9, actorId: ownerId })
      ).rejects.toThrow("Order not found.");
      await expect(
        updateOrderItemQuantity({ ...args(a.id), orderItemId: b.items[0].id, quantity: 9 })
      ).rejects.toThrow("Item not found on this order.");
    });
  });

  describe("delivery address and notes", () => {
    it("can be changed until the order is fulfilled, with an audit trail", async () => {
      const productId = await product(50);
      const order = await draft(await customer(), [{ productId, quantity: 1 }]);
      const details = { ...args(order.id), notes: "  Leave with the guard  ", deliveryAddress: "9 New Rd" };

      await updateOrderDetails(details);
      expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
        notes: "Leave with the guard",
        deliveryAddress: "9 New Rd",
      });

      await confirmOrder(args(order.id));
      await markOrderPaid(args(order.id));
      await updateOrderDetails({ ...details, deliveryAddress: "11 Newer Rd" }); // still allowed while paid
      await markOrderFulfilled(args(order.id));
      await expect(updateOrderDetails({ ...details, deliveryAddress: "Too late" })).rejects.toThrow(/can no longer be changed/);

      const log = await prisma.auditLog.findMany({ where: { entityId: order.id, action: "ORDER_DETAILS_UPDATED" } });
      expect(log).toHaveLength(2);
    });

    it("refuses a cancelled order", async () => {
      const productId = await product(50);
      const order = await draft(await customer(), [{ productId, quantity: 1 }]);
      await cancelOrder(args(order.id));
      await expect(updateOrderDetails({ ...args(order.id), notes: "x", deliveryAddress: "y" })).rejects.toThrow(
        /can no longer be changed/
      );
    });
  });

  describe("repeated order requests", () => {
    it("flags the same customer, same items and quantities within a day — and nothing else", async () => {
      const a = await product(100);
      const b = await product(100);
      const buyer = await customer();
      const first = await draft(buyer, [{ productId: a, quantity: 3 }, { productId: b, quantity: 2 }]);
      const repeat = await draft(buyer, [{ productId: b, quantity: 2 }, { productId: a, quantity: 3 }]); // order of lines doesn't matter

      expect((await findDuplicateOrders(organizationId, repeat.id)).map((d) => d.reference)).toEqual([first.reference]);

      const differentQty = await draft(buyer, [{ productId: a, quantity: 4 }, { productId: b, quantity: 2 }]);
      const differentItems = await draft(buyer, [{ productId: a, quantity: 3 }]);
      const otherBuyer = await draft(await customer(), [{ productId: a, quantity: 3 }, { productId: b, quantity: 2 }]);
      for (const o of [differentQty, differentItems, otherBuyer]) {
        expect(await findDuplicateOrders(organizationId, o.id), o.reference).toEqual([]);
      }
    });

    it("ignores cancelled orders and orders more than a day apart", async () => {
      const p = await product(100);
      const buyer = await customer();
      const old = await draft(buyer, [{ productId: p, quantity: 1 }]);
      await prisma.order.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000) } });
      const cancelled = await draft(buyer, [{ productId: p, quantity: 1 }]);
      await cancelOrder(args(cancelled.id));

      const fresh = await draft(buyer, [{ productId: p, quantity: 1 }]);
      expect(await findDuplicateOrders(organizationId, fresh.id)).toEqual([]);
    });

    it("blocks confirming a repeat until a person says it's intended, and records that they did", async () => {
      const p = await product(100);
      const buyer = await customer();
      const first = await draft(buyer, [{ productId: p, quantity: 2 }]);
      const repeat = await draft(buyer, [{ productId: p, quantity: 2 }]);

      const error = await confirmOrder(args(repeat.id)).catch((e) => e);
      expect(error).toBeInstanceOf(DuplicateOrderError);
      expect(error).toBeInstanceOf(OrderStateError);
      expect(error.references).toEqual([first.reference]);
      // Nothing happened: still a draft, nothing reserved.
      expect((await prisma.order.findUniqueOrThrow({ where: { id: repeat.id } })).status).toBe("DRAFT");
      expect(await getStockBreakdown(p)).toMatchObject({ reserved: 0 });

      await confirmOrder({ ...args(repeat.id), allowDuplicate: true });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: repeat.id } })).status).toBe("CONFIRMED");
      const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityId: repeat.id, action: "ORDER_CONFIRMED" } });
      expect(entry.after).toMatchObject({ confirmedDespiteDuplicateOf: [first.reference] });
    });

    it("an order with no lookalike confirms normally, with no override needed", async () => {
      const p = await product(100);
      const order = await draft(await customer(), [{ productId: p, quantity: 2 }]);
      await confirmOrder(args(order.id));
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CONFIRMED");
    });
  });

  describe("simultaneous actions on one order", () => {
    it("confirming the same draft from several places at once reserves its stock exactly once", async () => {
      const p = await product(10);
      const order = await draft(await customer(), [{ productId: p, quantity: 4 }]);
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => confirmOrder(args(order.id))));

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results.filter((r) => r.status === "rejected")) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(OrderStateError);
      }
      expect(await getStockBreakdown(p)).toEqual({ physical: 10, reserved: 4, damaged: 0, available: 6 });
    });

    it("marking one order paid twice at once only happens once", async () => {
      const p = await product(10);
      const order = await draft(await customer(), [{ productId: p, quantity: 1 }]);
      await confirmOrder(args(order.id));
      const results = await Promise.allSettled(Array.from({ length: 4 }, () => markOrderPaid(args(order.id))));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await prisma.auditLog.count({ where: { entityId: order.id, action: "PAYMENT_MARKED_PAID" } })).toBe(1);
    });
  });

  describe("cancelling a paid order", () => {
    async function paidOrder(quantity = 3) {
      const buyer = await customer();
      const productId = await product(20, { priceCents: 10000 });
      const order = await draft(buyer, [{ productId, quantity }]);
      await confirmOrder(args(order.id));
      await markOrderPaid(args(order.id));
      return { buyer, productId, order };
    }

    it("is an owner decision: staff are refused and nothing changes", async () => {
      const { productId, order } = await paidOrder();
      await expect(cancelOrder({ ...args(order.id, staffId), actorRole: "STAFF" })).rejects.toBeInstanceOf(ReturnPermissionError);
      await expect(cancelOrder(args(order.id, staffId))).rejects.toBeInstanceOf(ReturnPermissionError); // no role = not an owner

      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");
      expect(await getStockBreakdown(productId)).toMatchObject({ reserved: 3 });
      expect(await prisma.orderReturn.count({ where: { orderId: order.id } })).toBe(0);
    });

    it("releases the reserved stock and records the refund now owed", async () => {
      const { productId, order } = await paidOrder(3);
      await cancelOrder({ ...args(order.id), actorRole: "OWNER" });

      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CANCELLED");
      expect(await getStockBreakdown(productId)).toEqual({ physical: 20, reserved: 0, damaged: 0, available: 20 });

      const refund = await prisma.orderReturn.findFirstOrThrow({ where: { orderId: order.id } });
      expect(refund).toMatchObject({
        kind: "CANCELLATION",
        status: "RECEIVED",
        refundStatus: "PENDING",
        refundCents: 30000,
        decidedById: ownerId,
      });
      const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityId: order.id, action: "ORDER_CANCELLED" } });
      expect(entry.before).toMatchObject({ status: "PAID" });
      expect(entry.after).toMatchObject({ refundOwed: refund.reference, refundCents: 30000 });
    });

    it("shows up correctly in the customer's balance: cash still held, refund owed, then paid out", async () => {
      const { buyer, order } = await paidOrder(3);
      await cancelOrder({ ...args(order.id), actorRole: "OWNER" });

      const balance = async () => (await getCustomerBalances(organizationId, [buyer])).get(buyer)!;
      expect(await balance()).toMatchObject({
        paidCents: 30000, // they did pay
        refundDueCents: 30000, // and we owe it back
        refundedCents: 0,
        cashReceivedCents: 30000,
        balanceCents: -30000,
        outstandingCents: 0,
      });

      const refund = await prisma.orderReturn.findFirstOrThrow({ where: { orderId: order.id } });
      await markRefunded({ organizationId, returnId: refund.id, actor: { id: ownerId, role: "OWNER" }, note: "Transfer 991" });
      expect(await balance()).toMatchObject({
        paidCents: 30000,
        refundDueCents: 0,
        refundedCents: 30000,
        cashReceivedCents: 0, // nothing left once refunded — not negative
        balanceCents: 0,
      });
    });

    it("cannot also be 'returned' — the receive step would restock goods that never left", async () => {
      const { productId, order } = await paidOrder(3);
      await cancelOrder({ ...args(order.id), actorRole: "OWNER" });
      const refund = await prisma.orderReturn.findFirstOrThrow({ where: { orderId: order.id } });

      await expect(receiveReturn({ organizationId, returnId: refund.id, actor: { id: staffId, role: "STAFF" } })).rejects.toThrow(
        /already been received|approved/
      );
      await expect(
        requestReturn({
          organizationId,
          orderId: order.id,
          actor: { id: staffId, role: "STAFF" },
          reason: "x",
          items: [{ orderItemId: (await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } })).id, quantity: 1, condition: "RESELLABLE" }],
        })
      ).rejects.toThrow(/fulfilled orders/);
      expect(await getStockBreakdown(productId)).toMatchObject({ physical: 20, available: 20 });
    });

    it("cancelling the same paid order from several places at once creates one refund", async () => {
      const { productId, order } = await paidOrder(2);
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () => cancelOrder({ ...args(order.id), actorRole: "OWNER" }))
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await prisma.orderReturn.count({ where: { orderId: order.id } })).toBe(1);
      expect(await getStockBreakdown(productId)).toMatchObject({ reserved: 0, available: 20 }); // released once, not four times
    });

    it("a fulfilled order can't be cancelled — it goes through a return — and a cancelled one stays cancelled", async () => {
      const { order } = await paidOrder(1);
      await markOrderFulfilled(args(order.id));
      await expect(cancelOrder({ ...args(order.id), actorRole: "OWNER" })).rejects.toThrow(/record a return/);

      const second = await paidOrder(1);
      await cancelOrder({ ...args(second.order.id), actorRole: "OWNER" });
      await expect(cancelOrder({ ...args(second.order.id), actorRole: "OWNER" })).rejects.toThrow(/can't be cancelled/);
    });

    it("draft and confirmed cancellations are unchanged: no refund, and any reservation is released", async () => {
      const productId = await product(10);
      const buyer = await customer();
      const d = await draft(buyer, [{ productId, quantity: 2 }]);
      await cancelOrder(args(d.id, staffId)); // staff may cancel an unpaid order
      const c = await draft(buyer, [{ productId, quantity: 3 }]);
      await confirmOrder(args(c.id));
      expect(await getStockBreakdown(productId)).toMatchObject({ reserved: 3 });
      await cancelOrder(args(c.id, staffId));
      expect(await getStockBreakdown(productId)).toMatchObject({ reserved: 0, available: 10 });
      expect(await prisma.orderReturn.count({ where: { orderId: { in: [d.id, c.id] } } })).toBe(0);
    });
  });
});
