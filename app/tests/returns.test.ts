import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReturnItemCondition, StockMovementReason, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStockBreakdown, recordStockMovement } from "@/lib/stock";
import { confirmOrder, createDraftOrder, markOrderFulfilled, markOrderPaid } from "@/lib/orders";
import {
  ReturnPermissionError,
  ReturnStateError,
  decideReturn,
  getReturnableQuantities,
  markRefunded,
  receiveReturn,
  requestReturn,
} from "@/lib/returns";
import { getCustomerBalances } from "@/lib/balances";

describe("returns, refunds and customer balances", () => {
  let organizationId: string;
  let otherOrganizationId: string;
  let owner: { id: string; role: UserRole };
  let staff: { id: string; role: UserRole };
  let n = 0;

  beforeAll(async () => {
    organizationId = (await prisma.organization.create({ data: { name: "Returns Org" } })).id;
    otherOrganizationId = (await prisma.organization.create({ data: { name: "Other Returns Org" } })).id;
    const o = await prisma.user.create({
      data: { organizationId, email: "ret-owner@example.com", passwordHash: "x", name: "Owner", role: "OWNER" },
    });
    const s = await prisma.user.create({
      data: { organizationId, email: "ret-staff@example.com", passwordHash: "x", name: "Staff", role: "STAFF" },
    });
    owner = { id: o.id, role: "OWNER" };
    staff = { id: s.id, role: "STAFF" };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function newCustomer() {
    n += 1;
    return (await prisma.customer.create({ data: { organizationId, phone: `+1888000${n}`, name: `Customer ${n}` } })).id;
  }

  async function newProduct(stock: number, priceCents = 10000) {
    n += 1;
    const product = await prisma.product.create({
      data: { organizationId, sku: `RET-${n}`, name: `Return Product ${n}`, priceCents },
    });
    await recordStockMovement({
      organizationId,
      productId: product.id,
      quantityDelta: stock,
      reason: StockMovementReason.INITIAL_STOCK,
    });
    return product.id;
  }

  /** An order taken all the way to the given status. */
  async function orderAt(
    status: "CONFIRMED" | "PAID" | "FULFILLED",
    opts: { customerId?: string; items?: { productId: string; quantity: number }[] } = {}
  ) {
    const customerId = opts.customerId ?? (await newCustomer());
    const items = opts.items ?? [{ productId: await newProduct(20), quantity: 5 }];
    const order = await createDraftOrder({ organizationId, customerId, createdById: owner.id, items });
    const args = { organizationId, orderId: order.id, actorId: owner.id };
    await confirmOrder(args);
    if (status !== "CONFIRMED") await markOrderPaid(args);
    if (status === "FULFILLED") await markOrderFulfilled(args);
    return prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
  }

  const request = (
    orderId: string,
    items: { orderItemId: string; quantity: number; condition?: ReturnItemCondition }[],
    actor = staff
  ) =>
    requestReturn({
      organizationId,
      orderId,
      actor,
      reason: "Customer changed their mind",
      items: items.map((i) => ({ condition: "RESELLABLE" as const, ...i })),
    });

  describe("requesting a return", () => {
    it("only fulfilled orders can be returned", async () => {
      for (const status of ["CONFIRMED", "PAID"] as const) {
        const order = await orderAt(status);
        await expect(request(order.id, [{ orderItemId: order.items[0].id, quantity: 1 }])).rejects.toThrow(
          /fulfilled orders/
        );
      }
    });

    it("computes the refund from the order's locked prices, not today's catalogue price", async () => {
      const productId = await newProduct(20, 10000);
      const order = await orderAt("FULFILLED", { items: [{ productId, quantity: 5 }] });
      await prisma.product.update({ where: { id: productId }, data: { priceCents: 99999 } });

      const ret = await request(order.id, [{ orderItemId: order.items[0].id, quantity: 3 }]);
      expect(ret.refundCents).toBe(3 * 10000);
      expect(ret.status).toBe("REQUESTED");
      expect(ret.refundStatus).toBe("NONE"); // nothing is owed until the owner approves
      expect(ret.reference).toMatch(/^RET-\d+$/);
    });

    it("requesting moves no stock", async () => {
      const productId = await newProduct(20);
      const order = await orderAt("FULFILLED", { items: [{ productId, quantity: 5 }] });
      const before = await getStockBreakdown(productId);
      await request(order.id, [{ orderItemId: order.items[0].id, quantity: 2 }]);
      expect(await getStockBreakdown(productId)).toEqual(before);
    });

    it("cannot return more than was ordered, across several returns", async () => {
      const order = await orderAt("FULFILLED"); // 5 ordered
      const itemId = order.items[0].id;
      await request(order.id, [{ orderItemId: itemId, quantity: 3 }]);

      await expect(request(order.id, [{ orderItemId: itemId, quantity: 3 }])).rejects.toThrow(
        "Only 2 of that item can still be returned."
      );
      await request(order.id, [{ orderItemId: itemId, quantity: 2 }]);
      await expect(request(order.id, [{ orderItemId: itemId, quantity: 1 }])).rejects.toThrow(/already been returned in full/);
      expect((await getReturnableQuantities(order.id)).get(itemId)).toBe(0);
    });

    it("two simultaneous requests for the last units: exactly one is accepted", async () => {
      const order = await orderAt("FULFILLED"); // 5 ordered
      const itemId = order.items[0].id;
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () => request(order.id, [{ orderItemId: itemId, quantity: 3 }]))
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results.filter((r) => r.status === "rejected")) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ReturnStateError);
      }
    });

    it("rejects empty, zero, duplicate and foreign items, and a missing reason", async () => {
      const order = await orderAt("FULFILLED");
      const other = await orderAt("FULFILLED");
      const itemId = order.items[0].id;

      await expect(request(order.id, [])).rejects.toThrow(/at least one item/);
      await expect(request(order.id, [{ orderItemId: itemId, quantity: 0 }])).rejects.toThrow(/greater than zero/);
      await expect(request(order.id, [{ orderItemId: itemId, quantity: 1.5 }])).rejects.toThrow(/whole numbers/);
      await expect(
        request(order.id, [
          { orderItemId: itemId, quantity: 1 },
          { orderItemId: itemId, quantity: 1 },
        ])
      ).rejects.toThrow(/only appear once/);
      await expect(request(order.id, [{ orderItemId: other.items[0].id, quantity: 1 }])).rejects.toThrow(
        /not on this order/
      );
      await expect(
        requestReturn({
          organizationId,
          orderId: order.id,
          actor: staff,
          reason: "   ",
          items: [{ orderItemId: itemId, quantity: 1, condition: "RESELLABLE" }],
        })
      ).rejects.toThrow(/why/);
    });

    it("cannot reach an order in another organization", async () => {
      const order = await orderAt("FULFILLED");
      await expect(
        requestReturn({
          organizationId: otherOrganizationId,
          orderId: order.id,
          actor: staff,
          reason: "x",
          items: [{ orderItemId: order.items[0].id, quantity: 1, condition: "RESELLABLE" }],
        })
      ).rejects.toThrow("Order not found.");
    });
  });

  describe("owner approval", () => {
    it("staff cannot approve, reject or pay out; the owner can", async () => {
      const order = await orderAt("FULFILLED");
      const ret = await request(order.id, [{ orderItemId: order.items[0].id, quantity: 1 }]);

      await expect(
        decideReturn({ organizationId, returnId: ret.id, actor: staff, approve: true })
      ).rejects.toBeInstanceOf(ReturnPermissionError);
      await expect(
        decideReturn({ organizationId, returnId: ret.id, actor: staff, approve: false })
      ).rejects.toBeInstanceOf(ReturnPermissionError);
      expect((await prisma.orderReturn.findUniqueOrThrow({ where: { id: ret.id } })).status).toBe("REQUESTED");

      await decideReturn({ organizationId, returnId: ret.id, actor: owner, approve: true });
      await expect(markRefunded({ organizationId, returnId: ret.id, actor: staff })).rejects.toBeInstanceOf(
        ReturnPermissionError
      );
      const stored = await prisma.orderReturn.findUniqueOrThrow({ where: { id: ret.id } });
      expect(stored).toMatchObject({ status: "APPROVED", refundStatus: "PENDING", decidedById: owner.id });
    });

    it("a decision can only be made once", async () => {
      const order = await orderAt("FULFILLED");
      const ret = await request(order.id, [{ orderItemId: order.items[0].id, quantity: 1 }]);
      await decideReturn({ organizationId, returnId: ret.id, actor: owner, approve: false, note: "Worn" });
      await expect(decideReturn({ organizationId, returnId: ret.id, actor: owner, approve: true })).rejects.toThrow(
        /already been decided/
      );
      const stored = await prisma.orderReturn.findUniqueOrThrow({ where: { id: ret.id } });
      expect(stored).toMatchObject({ status: "REJECTED", refundStatus: "NONE", decisionNote: "Worn" });
    });

    it("a rejected return frees its quantity to be returned again", async () => {
      const order = await orderAt("FULFILLED");
      const itemId = order.items[0].id;
      const ret = await request(order.id, [{ orderItemId: itemId, quantity: 5 }]);
      await expect(request(order.id, [{ orderItemId: itemId, quantity: 1 }])).rejects.toThrow();
      await decideReturn({ organizationId, returnId: ret.id, actor: owner, approve: false });
      await request(order.id, [{ orderItemId: itemId, quantity: 5 }]);
    });
  });

  describe("receiving goods", () => {
    it("puts resellable units back in available stock and damaged units in the damaged figure", async () => {
      const a = await newProduct(20);
      const b = await newProduct(20);
      const order = await orderAt("FULFILLED", {
        items: [
          { productId: a, quantity: 5 },
          { productId: b, quantity: 5 },
        ],
      });
      const itemA = order.items.find((i) => i.productId === a)!;
      const itemB = order.items.find((i) => i.productId === b)!;
      expect(await getStockBreakdown(a)).toEqual({ physical: 15, reserved: 0, damaged: 0, available: 15 });

      const ret = await request(order.id, [
        { orderItemId: itemA.id, quantity: 2, condition: "RESELLABLE" },
        { orderItemId: itemB.id, quantity: 3, condition: "DAMAGED" },
      ]);
      await decideReturn({ organizationId, returnId: ret.id, actor: owner, approve: true });
      await receiveReturn({ organizationId, returnId: ret.id, actor: staff });

      expect(await getStockBreakdown(a)).toEqual({ physical: 17, reserved: 0, damaged: 0, available: 17 });
      expect(await getStockBreakdown(b)).toEqual({ physical: 18, reserved: 0, damaged: 3, available: 15 });

      const movements = await prisma.stockMovement.findMany({ where: { reference: ret.reference } });
      expect(movements.map((m) => m.reason).sort()).toEqual(["RETURN", "RETURN_DAMAGED"]);
      expect((await prisma.orderReturn.findUniqueOrThrow({ where: { id: ret.id } })).status).toBe("RECEIVED");
    });

    it("needs approval first, and happens exactly once even when submitted concurrently", async () => {
      const productId = await newProduct(20);
      const order = await orderAt("FULFILLED", { items: [{ productId, quantity: 5 }] });
      const ret = await request(order.id, [{ orderItemId: order.items[0].id, quantity: 2 }]);

      await expect(receiveReturn({ organizationId, returnId: ret.id, actor: staff })).rejects.toThrow(/approved/);
      expect(await getStockBreakdown(productId)).toMatchObject({ physical: 15 });

      await decideReturn({ organizationId, returnId: ret.id, actor: owner, approve: true });
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () => receiveReturn({ organizationId, returnId: ret.id, actor: staff }))
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await getStockBreakdown(productId)).toMatchObject({ physical: 17, available: 17 }); // +2, not +8
    });
  });

  describe("refunds", () => {
    it("is payable only after approval and can be recorded exactly once, even concurrently", async () => {
      const order = await orderAt("FULFILLED");
      const ret = await request(order.id, [{ orderItemId: order.items[0].id, quantity: 1 }]);

      await expect(markRefunded({ organizationId, returnId: ret.id, actor: owner })).rejects.toThrow(/approved return/);
      await decideReturn({ organizationId, returnId: ret.id, actor: owner, approve: true });

      const results = await Promise.allSettled(
        Array.from({ length: 3 }, () => markRefunded({ organizationId, returnId: ret.id, actor: owner, note: "Bank transfer" }))
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const stored = await prisma.orderReturn.findUniqueOrThrow({ where: { id: ret.id } });
      expect(stored).toMatchObject({ refundStatus: "REFUNDED", refundNote: "Bank transfer" });
      expect(stored.refundedAt).not.toBeNull();

      const audit = await prisma.auditLog.findMany({
        where: { entityId: order.id, action: "REFUND_PAID" },
      });
      expect(audit).toHaveLength(1);
    });

    it("a rejected return has no refund to pay", async () => {
      const order = await orderAt("FULFILLED");
      const ret = await request(order.id, [{ orderItemId: order.items[0].id, quantity: 1 }]);
      await decideReturn({ organizationId, returnId: ret.id, actor: owner, approve: false });
      await expect(markRefunded({ organizationId, returnId: ret.id, actor: owner })).rejects.toThrow(/approved return/);
    });
  });

  it("writes the whole return story to the order's audit history", async () => {
    const order = await orderAt("FULFILLED");
    const ret = await request(order.id, [{ orderItemId: order.items[0].id, quantity: 1 }]);
    await decideReturn({ organizationId, returnId: ret.id, actor: owner, approve: true });
    await receiveReturn({ organizationId, returnId: ret.id, actor: staff });
    await markRefunded({ organizationId, returnId: ret.id, actor: owner });

    const audit = await prisma.auditLog.findMany({
      where: { entity: "Order", entityId: order.id },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((a) => a.action)).toEqual([
      "ORDER_DRAFTED",
      "ORDER_CONFIRMED",
      "PAYMENT_MARKED_PAID",
      "ORDER_FULFILLED",
      "RETURN_REQUESTED",
      "RETURN_APPROVED",
      "RETURN_RECEIVED",
      "REFUND_PAID",
    ]);
  });

  describe("customer balances", () => {
    it("is all zeros for a customer with no activity", async () => {
      const customerId = await newCustomer();
      expect((await getCustomerBalances(organizationId, [customerId])).get(customerId)).toBeUndefined();
    });

    it("separates what they owe, what they paid, what we owe, and what we've refunded", async () => {
      const customerId = await newCustomer();
      const productId = await newProduct(100, 10000);
      const line = (quantity: number) => [{ productId, quantity }];

      await orderAt("CONFIRMED", { customerId, items: line(2) }); // owes 20,000
      await orderAt("PAID", { customerId, items: line(3) }); // paid 30,000
      const fulfilled = await orderAt("FULFILLED", { customerId, items: line(10) }); // paid 100,000
      const itemId = fulfilled.items[0].id;

      let balance = (await getCustomerBalances(organizationId, [customerId])).get(customerId)!;
      expect(balance).toEqual({
        outstandingCents: 20000,
        paidCents: 130000,
        refundedCents: 0,
        refundDueCents: 0,
        refundRequestedCents: 0,
        cashReceivedCents: 130000,
        balanceCents: 20000, // they owe us
      });

      // A requested return is flagged but not yet owed.
      const r1 = await request(fulfilled.id, [{ orderItemId: itemId, quantity: 4 }]); // 40,000
      balance = (await getCustomerBalances(organizationId, [customerId])).get(customerId)!;
      expect(balance).toMatchObject({ refundRequestedCents: 40000, refundDueCents: 0, balanceCents: 20000 });

      // Approved: we now owe it, which offsets what they owe us.
      await decideReturn({ organizationId, returnId: r1.id, actor: owner, approve: true });
      balance = (await getCustomerBalances(organizationId, [customerId])).get(customerId)!;
      expect(balance).toMatchObject({ refundRequestedCents: 0, refundDueCents: 40000, balanceCents: 20000 - 40000 });

      // Paid out: no longer owed, and cash received falls by the refund.
      await markRefunded({ organizationId, returnId: r1.id, actor: owner });
      balance = (await getCustomerBalances(organizationId, [customerId])).get(customerId)!;
      expect(balance).toMatchObject({
        refundDueCents: 0,
        refundedCents: 40000,
        cashReceivedCents: 130000 - 40000,
        balanceCents: 20000,
      });

      // A rejected return counts for nothing.
      const r2 = await request(fulfilled.id, [{ orderItemId: itemId, quantity: 6 }]);
      await decideReturn({ organizationId, returnId: r2.id, actor: owner, approve: false });
      balance = (await getCustomerBalances(organizationId, [customerId])).get(customerId)!;
      expect(balance).toMatchObject({ refundRequestedCents: 0, refundDueCents: 0, refundedCents: 40000 });
    });

    it("does not leak between customers or organizations", async () => {
      const a = await newCustomer();
      const b = await newCustomer();
      await orderAt("CONFIRMED", { customerId: a });
      const balances = await getCustomerBalances(organizationId, [a, b]);
      expect(balances.get(a)!.outstandingCents).toBeGreaterThan(0);
      expect(balances.get(b)).toBeUndefined();
      expect((await getCustomerBalances(otherOrganizationId, [a])).get(a)).toBeUndefined();
    });
  });
});
