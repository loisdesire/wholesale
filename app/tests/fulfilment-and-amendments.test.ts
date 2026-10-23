import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StockMovementReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { phoneKeyOf } from "@/lib/phone";
import { getStockBreakdown, recordStockMovement } from "@/lib/stock";
import {
  OrderStateError,
  amendConfirmedOrder,
  cancelOrder,
  closeOrderShort,
  confirmOrder,
  createDraftOrder,
  markOrderFulfilled,
  markOrderPaid,
  shipOrderItems,
} from "@/lib/orders";
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
import { setCustomerPrice } from "@/lib/customers";

describe("partial fulfilment, partial refunds and amendments", () => {
  let organizationId: string;
  let owner: { id: string; role: "OWNER" | "STAFF" };
  let staff: { id: string; role: "OWNER" | "STAFF" };
  let n = 0;

  beforeAll(async () => {
    organizationId = (await prisma.organization.create({ data: { name: "Fulfilment Org" } })).id;
    const o = await prisma.user.create({
      data: { memberships: { create: { organizationId, role: "OWNER" } }, email: "ful-owner@example.com", passwordHash: "x", name: "Owner" },
    });
    const s = await prisma.user.create({
      data: { memberships: { create: { organizationId, role: "STAFF" } }, email: "ful-staff@example.com", passwordHash: "x", name: "Staff" },
    });
    owner = { id: o.id, role: "OWNER" };
    staff = { id: s.id, role: "STAFF" };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function customer() {
    n += 1;
    const phone = `+1666${String(1000000 + n)}`;
    return (await prisma.customer.create({ data: { organizationId, phone, phoneKey: phoneKeyOf(phone)!, name: `C${n}` } })).id;
  }

  async function product(stock: number, opts: { priceCents?: number; moq?: number; tiers?: { minQuantity: number; priceCents: number }[] } = {}) {
    n += 1;
    const p = await prisma.product.create({
      data: {
        organizationId,
        sku: `FUL-${n}`,
        name: `Fulfilment Product ${n}`,
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

  const a = (orderId: string, actorId = owner.id) => ({ organizationId, orderId, actorId });

  async function order(status: "DRAFT" | "CONFIRMED" | "PAID", items: { productId: string; quantity: number }[], customerId?: string) {
    const created = await createDraftOrder({
      organizationId,
      customerId: customerId ?? (await customer()),
      createdById: owner.id,
      items,
    });
    if (status !== "DRAFT") await confirmOrder({ ...a(created.id), allowDuplicate: true });
    if (status === "PAID") await markOrderPaid(a(created.id));
    return prisma.order.findUniqueOrThrow({ where: { id: created.id }, include: { items: true } });
  }

  const lineFor = (o: { items: { id: string; productId: string }[] }, productId: string) => o.items.find((i) => i.productId === productId)!;

  describe("shipping in pieces", () => {
    it("moves each shipment's units out of physical and reserved, and tracks progress to FULFILLED", async () => {
      const pa = await product(100);
      const pb = await product(50);
      const o = await order("PAID", [{ productId: pa, quantity: 10 }, { productId: pb, quantity: 4 }]);

      const first = await shipOrderItems({
        ...a(o.id),
        items: [{ orderItemId: lineFor(o, pa).id, quantity: 6 }],
        carrier: "GIG",
        trackingReference: "TRK-1",
      });
      expect(first.order.status).toBe("PARTIALLY_FULFILLED");
      expect(first.shipment).toMatchObject({ reference: `${o.reference}/1`, carrier: "GIG", trackingReference: "TRK-1" });
      expect(await getStockBreakdown(pa, prisma)).toEqual({ physical: 94, reserved: 4, damaged: 0, available: 90 });
      expect(await getStockBreakdown(pb, prisma)).toEqual({ physical: 50, reserved: 4, damaged: 0, available: 46 });

      const second = await shipOrderItems({
        ...a(o.id),
        items: [{ orderItemId: lineFor(o, pa).id, quantity: 4 }, { orderItemId: lineFor(o, pb).id, quantity: 4 }],
      });
      expect(second.order.status).toBe("FULFILLED");
      expect(second.order.fulfilledAt).not.toBeNull();
      expect(second.shipment.reference).toBe(`${o.reference}/2`);
      expect(await getStockBreakdown(pa, prisma)).toEqual({ physical: 90, reserved: 0, damaged: 0, available: 90 });
      expect(await getStockBreakdown(pb, prisma)).toEqual({ physical: 46, reserved: 0, damaged: 0, available: 46 });

      const audit = await prisma.auditLog.findMany({ where: { entityId: o.id, action: { startsWith: "ORDER_" } }, orderBy: { createdAt: "asc" } });
      expect(audit.map((x) => x.action)).toEqual([
        "ORDER_DRAFTED",
        "ORDER_CONFIRMED",
        "ORDER_PARTIALLY_SHIPPED",
        "ORDER_FULFILLED",
      ]);
    });

    it("markOrderFulfilled ships whatever is still outstanding", async () => {
      const p = await product(20);
      const o = await order("PAID", [{ productId: p, quantity: 8 }]);
      await shipOrderItems({ ...a(o.id), items: [{ orderItemId: o.items[0].id, quantity: 3 }] });
      const done = await markOrderFulfilled(a(o.id));
      expect(done.status).toBe("FULFILLED");
      const shipped = await prisma.shipmentItem.aggregate({ where: { shipment: { orderId: o.id } }, _sum: { quantity: true } });
      expect(shipped._sum.quantity).toBe(8);
      expect(await getStockBreakdown(p, prisma)).toEqual({ physical: 12, reserved: 0, damaged: 0, available: 12 });
    });

    it("rejects over-shipping and malformed lines, recording nothing", async () => {
      const p = await product(20);
      const o = await order("PAID", [{ productId: p, quantity: 5 }]);
      const itemId = o.items[0].id;
      const ship = (quantity: number, orderItemId = itemId) => shipOrderItems({ ...a(o.id), items: [{ orderItemId, quantity }] });

      await expect(ship(6)).rejects.toThrow(/Only 5 of .* left to ship/);
      await expect(ship(0)).rejects.toThrow(/greater than zero/);
      await expect(ship(-1)).rejects.toThrow(/greater than zero/);
      await expect(ship(1.5)).rejects.toThrow(/whole numbers/);
      await expect(ship(1, "not-a-line")).rejects.toThrow(/not on this order/);
      await expect(
        shipOrderItems({ ...a(o.id), items: [{ orderItemId: itemId, quantity: 1 }, { orderItemId: itemId, quantity: 1 }] })
      ).rejects.toThrow(/only appear once/);
      await expect(shipOrderItems({ ...a(o.id), items: [] })).rejects.toThrow(/at least one item/);

      expect(await prisma.shipment.count({ where: { orderId: o.id } })).toBe(0);
      expect(await getStockBreakdown(p, prisma)).toMatchObject({ physical: 20, reserved: 5 });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("PAID");
    });

    it("only paid (or part-shipped) orders can ship, and a finished order can't ship again", async () => {
      const p = await product(20);
      for (const status of ["DRAFT", "CONFIRMED"] as const) {
        const o = await order(status, [{ productId: p, quantity: 1 }]);
        await expect(shipOrderItems({ ...a(o.id) })).rejects.toThrow("Only paid orders can be marked as fulfilled.");
      }
      const paid = await order("PAID", [{ productId: p, quantity: 1 }]);
      await markOrderFulfilled(a(paid.id));
      await expect(shipOrderItems({ ...a(paid.id) })).rejects.toThrow("Only paid orders can be marked as fulfilled.");
    });

    it("simultaneous shipments of the same units never ship more than ordered", async () => {
      const p = await product(20);
      const o = await order("PAID", [{ productId: p, quantity: 6 }]);
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () => shipOrderItems({ ...a(o.id), items: [{ orderItemId: o.items[0].id, quantity: 4 }] }))
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1); // 4 of 6 once; the rest would exceed
      for (const r of results.filter((r) => r.status === "rejected")) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(OrderStateError);
      }
      expect(await getStockBreakdown(p, prisma)).toEqual({ physical: 16, reserved: 2, damaged: 0, available: 14 });
    });

    it("can't be cancelled once part has shipped", async () => {
      const p = await product(20);
      const o = await order("PAID", [{ productId: p, quantity: 4 }]);
      await shipOrderItems({ ...a(o.id), items: [{ orderItemId: o.items[0].id, quantity: 1 }] });
      await expect(cancelOrder({ ...a(o.id), actorRole: "OWNER" })).rejects.toThrow(/close the remainder short/);
    });
  });

  describe("returns follow what actually shipped", () => {
    it("allows returning shipped units from a part-shipped order, never unshipped ones", async () => {
      const p = await product(50);
      const o = await order("PAID", [{ productId: p, quantity: 10 }]);
      const itemId = o.items[0].id;
      await shipOrderItems({ ...a(o.id), items: [{ orderItemId: itemId, quantity: 6 }] });

      expect((await getReturnableQuantities(o.id, prisma)).get(itemId)).toBe(6);
      const request = (quantity: number) =>
        requestReturn({ organizationId, orderId: o.id, actor: staff, reason: "faulty", items: [{ orderItemId: itemId, quantity, condition: "RESELLABLE" }] });
      await expect(request(7)).rejects.toThrow("Only 6 of that item can still be returned.");
      await request(4);
      expect((await getReturnableQuantities(o.id, prisma)).get(itemId)).toBe(2);
    });

    it("an order with nothing shipped has nothing to return", async () => {
      const p = await product(50);
      const o = await order("PAID", [{ productId: p, quantity: 3 }]);
      await expect(
        requestReturn({ organizationId, orderId: o.id, actor: staff, reason: "x", items: [{ orderItemId: o.items[0].id, quantity: 1, condition: "RESELLABLE" }] })
      ).rejects.toThrow(/orders that have shipped/);
    });
  });

  describe("closing a part-shipped order short", () => {
    async function partShipped(shipQty = 6, orderQty = 10) {
      const buyer = await customer();
      const productId = await product(50, { priceCents: 10000 });
      const o = await order("PAID", [{ productId, quantity: orderQty }], buyer);
      await shipOrderItems({ ...a(o.id), items: [{ orderItemId: o.items[0].id, quantity: shipQty }] });
      return { buyer, productId, o };
    }

    it("is an owner decision with a reason", async () => {
      const { o } = await partShipped();
      await expect(closeOrderShort({ ...a(o.id, staff.id), actorRole: "STAFF", reason: "supplier out" })).rejects.toBeInstanceOf(ReturnPermissionError);
      await expect(closeOrderShort({ ...a(o.id), actorRole: "OWNER", reason: "  " })).rejects.toThrow(/Say why/);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("PARTIALLY_FULFILLED");
    });

    it("releases the unshipped reservation, records the refund owed, and completes the order", async () => {
      const { productId, o } = await partShipped(6, 10);
      const { order: closed, refund } = await closeOrderShort({ ...a(o.id), actorRole: "OWNER", reason: "Supplier couldn't deliver" });

      expect(closed.status).toBe("FULFILLED");
      expect(await getStockBreakdown(productId, prisma)).toEqual({ physical: 44, reserved: 0, damaged: 0, available: 44 });
      expect(refund).toMatchObject({ kind: "UNSHIPPED", status: "RECEIVED", refundStatus: "PENDING", valueCents: 40000, refundCents: 40000 });
      const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityId: o.id, action: "ORDER_CLOSED_SHORT" } });
      expect(entry.after).toMatchObject({ unitsNotShipped: 4, refundCents: 40000, reason: "Supplier couldn't deliver" });
    });

    it("balances: the customer paid in full, is owed the unshipped part, and nothing is double counted", async () => {
      const { buyer, o } = await partShipped(6, 10);
      const balance = async () => (await getCustomerBalances(organizationId, [buyer])).get(buyer)!;

      // Part-shipped counts as paid.
      expect(await balance()).toMatchObject({ paidCents: 100000, refundDueCents: 0 });

      await closeOrderShort({ ...a(o.id), actorRole: "OWNER", reason: "Out of stock at supplier" });
      expect(await balance()).toMatchObject({ paidCents: 100000, refundDueCents: 40000, balanceCents: -40000, cashReceivedCents: 100000 });

      const refund = await prisma.orderReturn.findFirstOrThrow({ where: { orderId: o.id } });
      await markRefunded({ organizationId, returnId: refund.id, actor: owner });
      expect(await balance()).toMatchObject({ refundDueCents: 0, refundedCents: 40000, cashReceivedCents: 60000, balanceCents: 0 }); // = value of what shipped
    });

    it("can only close an order that has partly shipped, and only once", async () => {
      const p = await product(20);
      const paid = await order("PAID", [{ productId: p, quantity: 2 }]);
      await expect(closeOrderShort({ ...a(paid.id), actorRole: "OWNER", reason: "x" })).rejects.toThrow(/partly shipped/);

      const { o } = await partShipped();
      const results = await Promise.allSettled(
        Array.from({ length: 3 }, () => closeOrderShort({ ...a(o.id), actorRole: "OWNER", reason: "Supplier issue" }))
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await prisma.orderReturn.count({ where: { orderId: o.id } })).toBe(1);
    });

    it("what did ship can still be returned after closing short, but not the unshipped units", async () => {
      const { o } = await partShipped(6, 10);
      await closeOrderShort({ ...a(o.id), actorRole: "OWNER", reason: "Supplier issue" });
      expect((await getReturnableQuantities(o.id, prisma)).get(o.items[0].id)).toBe(6);
    });

    it("the 'goods received' step can't restock an UNSHIPPED refund", async () => {
      const { productId, o } = await partShipped(6, 10);
      await closeOrderShort({ ...a(o.id), actorRole: "OWNER", reason: "Supplier issue" });
      const refund = await prisma.orderReturn.findFirstOrThrow({ where: { orderId: o.id } });
      await expect(receiveReturn({ organizationId, returnId: refund.id, actor: staff })).rejects.toBeInstanceOf(ReturnStateError);
      expect(await getStockBreakdown(productId, prisma)).toMatchObject({ physical: 44, available: 44 });
    });
  });

  describe("partial refunds", () => {
    async function requested(quantity = 4) {
      const buyer = await customer();
      const productId = await product(50, { priceCents: 10000 });
      const o = await order("PAID", [{ productId, quantity: 10 }], buyer);
      await markOrderFulfilled(a(o.id));
      const ret = await requestReturn({
        organizationId,
        orderId: o.id,
        actor: staff,
        reason: "Faulty",
        items: [{ orderItemId: o.items[0].id, quantity, condition: "RESELLABLE" }],
      });
      return { buyer, ret, o };
    }

    it("lets the owner approve less than the goods' value, with a reason, keeping the value on record", async () => {
      const { buyer, ret } = await requested(4); // worth 40,000
      expect(ret).toMatchObject({ valueCents: 40000, refundCents: 40000 });

      await decideReturn({ organizationId, returnId: ret.id, actor: owner, approve: true, refundCents: 30000, note: "₦10,000 restocking fee" });
      const stored = await prisma.orderReturn.findUniqueOrThrow({ where: { id: ret.id } });
      expect(stored).toMatchObject({ status: "APPROVED", refundStatus: "PENDING", valueCents: 40000, refundCents: 30000 });

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "RETURN_APPROVED", after: { path: ["return"], equals: ret.reference } } });
      expect(audit.after).toMatchObject({ refundCents: 30000, valueCents: 40000, partial: true });

      // Balances use what is actually owed.
      const balance = (await getCustomerBalances(organizationId, [buyer])).get(buyer)!;
      expect(balance.refundDueCents).toBe(30000);
      await markRefunded({ organizationId, returnId: ret.id, actor: owner });
      expect((await getCustomerBalances(organizationId, [buyer])).get(buyer)).toMatchObject({ refundedCents: 30000, cashReceivedCents: 100000 - 30000 });
    });

    it("rejects a reduction with no reason, zero, negative, fractional or more than the value", async () => {
      const { ret } = await requested(4);
      const approve = (refundCents: number, note?: string) =>
        decideReturn({ organizationId, returnId: ret.id, actor: owner, approve: true, refundCents, note });
      await expect(approve(30000)).rejects.toThrow(/Say why the refund is less/);
      await expect(approve(0, "x")).rejects.toThrow(/partial refund must be/);
      await expect(approve(-5, "x")).rejects.toThrow(/partial refund must be/);
      await expect(approve(100.5, "x")).rejects.toThrow(/partial refund must be/);
      await expect(approve(40001, "x")).rejects.toThrow(/partial refund must be/);
      expect((await prisma.orderReturn.findUniqueOrThrow({ where: { id: ret.id } })).status).toBe("REQUESTED");
    });

    it("defaults to the full value, and an explicit full amount needs no reason", async () => {
      const first = await requested(2);
      await decideReturn({ organizationId, returnId: first.ret.id, actor: owner, approve: true });
      expect((await prisma.orderReturn.findUniqueOrThrow({ where: { id: first.ret.id } })).refundCents).toBe(20000);

      const second = await requested(3);
      await decideReturn({ organizationId, returnId: second.ret.id, actor: owner, approve: true, refundCents: 30000 });
      expect((await prisma.orderReturn.findUniqueOrThrow({ where: { id: second.ret.id } })).refundCents).toBe(30000);
    });

    it("staff still can't decide, and a rejection pays nothing", async () => {
      const { ret } = await requested(2);
      await expect(
        decideReturn({ organizationId, returnId: ret.id, actor: staff, approve: true, refundCents: 100, note: "x" })
      ).rejects.toBeInstanceOf(ReturnPermissionError);
      await decideReturn({ organizationId, returnId: ret.id, actor: owner, approve: false, note: "Not our product" });
      expect((await prisma.orderReturn.findUniqueOrThrow({ where: { id: ret.id } })).refundStatus).toBe("NONE");
    });
  });

  describe("amending a confirmed order", () => {
    const amend = (orderId: string, amendment: Parameters<typeof amendConfirmedOrder>[0]["amendment"], reason = "Customer changed their mind", actorId = staff.id) =>
      amendConfirmedOrder({ organizationId, orderId, actorId, reason, amendment });

    /** The invariant everything below leans on: reserved stock equals what the order's lines say. */
    async function expectReservedMatchesLines(o: { id: string }, productId: string) {
      const items = await prisma.orderItem.findMany({ where: { orderId: o.id, productId } });
      const lineUnits = items.reduce((sum, i) => sum + i.quantity, 0);
      const reserved = await prisma.stockMovement.aggregate({ where: { productId }, _sum: { reservedDelta: true } });
      expect(reserved._sum.reservedDelta ?? 0).toBe(lineUnits);
    }

    it("increasing a quantity reserves the extra and re-prices that line at its new tier", async () => {
      const p = await product(100, { tiers: [{ minQuantity: 10, priceCents: 8000 }] });
      const o = await order("CONFIRMED", [{ productId: p, quantity: 4 }]);
      expect(o.totalCents).toBe(40000);

      const updated = await amend(o.id, { changes: [{ orderItemId: o.items[0].id, quantity: 12 }] });
      expect(updated.totalCents).toBe(12 * 8000);
      expect(await prisma.orderItem.findUniqueOrThrow({ where: { id: o.items[0].id } })).toMatchObject({ quantity: 12, unitPriceCents: 8000 });
      expect(await getStockBreakdown(p, prisma)).toEqual({ physical: 100, reserved: 12, damaged: 0, available: 88 });
      await expectReservedMatchesLines(o, p);
    });

    it("decreasing releases the difference; a quantity of 0 removes the line and releases it all", async () => {
      const pa = await product(100);
      const pb = await product(100);
      const o = await order("CONFIRMED", [{ productId: pa, quantity: 10 }, { productId: pb, quantity: 5 }]);

      await amend(o.id, { changes: [{ orderItemId: lineFor(o, pa).id, quantity: 7 }, { orderItemId: lineFor(o, pb).id, quantity: 0 }] });
      expect(await getStockBreakdown(pa, prisma)).toMatchObject({ reserved: 7, available: 93 });
      expect(await getStockBreakdown(pb, prisma)).toMatchObject({ reserved: 0, available: 100 });
      expect(await prisma.orderItem.count({ where: { orderId: o.id } })).toBe(1);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).totalCents).toBe(70000);
    });

    it("adds a new product (reserving it) or merges into the existing line for that product", async () => {
      const pa = await product(100);
      const pb = await product(100, { priceCents: 25000 });
      const o = await order("CONFIRMED", [{ productId: pa, quantity: 3 }]);

      await amend(o.id, { additions: [{ productId: pb, quantity: 2 }, { productId: pa, quantity: 2 }] });
      const items = await prisma.orderItem.findMany({ where: { orderId: o.id }, orderBy: { createdAt: "asc" } });
      expect(items.map((i) => [i.productId, i.quantity])).toEqual([[pa, 5], [pb, 2]]);
      expect(await getStockBreakdown(pa, prisma)).toMatchObject({ reserved: 5 });
      expect(await getStockBreakdown(pb, prisma)).toMatchObject({ reserved: 2 });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).totalCents).toBe(5 * 10000 + 2 * 25000);
    });

    it("re-prices only the lines that changed; untouched lines keep their locked price", async () => {
      const pa = await product(100, { priceCents: 10000 });
      const pb = await product(100, { priceCents: 20000 });
      const o = await order("CONFIRMED", [{ productId: pa, quantity: 2 }, { productId: pb, quantity: 2 }]);
      await prisma.product.update({ where: { id: pa }, data: { priceCents: 99000 } });
      await prisma.product.update({ where: { id: pb }, data: { priceCents: 55000 } });

      await amend(o.id, { changes: [{ orderItemId: lineFor(o, pb).id, quantity: 3 }] });
      expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: lineFor(o, pa).id } })).unitPriceCents).toBe(10000); // untouched
      expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: lineFor(o, pb).id } })).unitPriceCents).toBe(55000); // re-priced
    });

    it("uses the customer's agreed price for changed lines", async () => {
      const p = await product(100, { priceCents: 10000 });
      const buyer = await customer();
      await setCustomerPrice({ organizationId, customerId: buyer, productId: p, priceCents: 7000, actorId: owner.id, actorRole: "OWNER" });
      const o = await order("CONFIRMED", [{ productId: p, quantity: 2 }], buyer);
      await amend(o.id, { changes: [{ orderItemId: o.items[0].id, quantity: 5 }] });
      expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: o.items[0].id } })).unitPriceCents).toBe(7000);
    });

    it("is all-or-nothing: if stock can't cover one part, nothing changes — not even the parts that could", async () => {
      const pa = await product(100);
      const scarce = await product(2);
      const o = await order("CONFIRMED", [{ productId: pa, quantity: 3 }]);

      await expect(
        amend(o.id, { changes: [{ orderItemId: o.items[0].id, quantity: 9 }], additions: [{ productId: scarce, quantity: 5 }] })
      ).rejects.toThrow(/available/);
      expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: o.items[0].id } })).quantity).toBe(3);
      expect(await prisma.orderItem.count({ where: { orderId: o.id } })).toBe(1);
      expect(await getStockBreakdown(pa, prisma)).toMatchObject({ reserved: 3 });
      expect(await getStockBreakdown(scarce, prisma)).toMatchObject({ reserved: 0 });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).totalCents).toBe(30000);
    });

    it("sums two lines of the same product when working out the stock change", async () => {
      const p = await product(100);
      const o = await createDraftOrder({
        organizationId,
        customerId: await customer(),
        createdById: owner.id,
        items: [{ productId: p, quantity: 2 }],
      });
      const { addOrderItem } = await import("@/lib/orders");
      await addOrderItem({ organizationId, orderId: o.id, productId: p, quantity: 3 }); // second line, same product
      await confirmOrder({ ...a(o.id), allowDuplicate: true });
      const items = await prisma.orderItem.findMany({ where: { orderId: o.id } });
      expect(items).toHaveLength(2);

      await amend(o.id, { changes: [{ orderItemId: items[0].id, quantity: 1 }, { orderItemId: items[1].id, quantity: 6 }] });
      await expectReservedMatchesLines(o, p); // 1 + 6 = 7
    });

    it("records who, why, and the before/after lines", async () => {
      const p = await product(100);
      const o = await order("CONFIRMED", [{ productId: p, quantity: 4 }]);
      await amend(o.id, { changes: [{ orderItemId: o.items[0].id, quantity: 6 }] }, "Customer asked for two more", staff.id);
      const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityId: o.id, action: "ORDER_AMENDED" } });
      expect(entry.actorId).toBe(staff.id);
      expect(entry.before).toMatchObject({ totalCents: 40000, lines: [{ quantity: 4, unitPriceCents: 10000 }] });
      expect(entry.after).toMatchObject({ totalCents: 60000, reason: "Customer asked for two more", lines: [{ quantity: 6 }] });
    });

    it("needs a reason, a real change, and only works on a confirmed unpaid order", async () => {
      const p = await product(100);
      const confirmed = await order("CONFIRMED", [{ productId: p, quantity: 2 }]);
      const itemId = confirmed.items[0].id;
      await expect(amend(confirmed.id, { changes: [{ orderItemId: itemId, quantity: 3 }] }, "  ")).rejects.toThrow(/Say why/);
      await expect(amend(confirmed.id, {})).rejects.toThrow(/Nothing to change/);
      await expect(amend(confirmed.id, { changes: [{ orderItemId: itemId, quantity: 2 }] })).resolves.toBeDefined(); // no-op line is harmless

      const draft = await order("DRAFT", [{ productId: p, quantity: 2 }]);
      await expect(amend(draft.id, { changes: [{ orderItemId: draft.items[0].id, quantity: 3 }] })).rejects.toThrow(/edited directly/);
      const paid = await order("PAID", [{ productId: p, quantity: 2 }]);
      await expect(amend(paid.id, { changes: [{ orderItemId: paid.items[0].id, quantity: 3 }] })).rejects.toThrow(/hasn't been paid/);
    });

    it("rejects bad quantities, MOQ breaches, removing everything, and lines from other orders", async () => {
      const p = await product(100, { moq: 5 });
      const o = await order("CONFIRMED", [{ productId: p, quantity: 5 }]);
      const other = await order("CONFIRMED", [{ productId: p, quantity: 5 }]);
      const itemId = o.items[0].id;

      await expect(amend(o.id, { changes: [{ orderItemId: itemId, quantity: 3 }] })).rejects.toThrow(/minimum order quantity of 5/);
      await expect(amend(o.id, { changes: [{ orderItemId: itemId, quantity: -1 }] })).rejects.toThrow(/whole numbers/);
      await expect(amend(o.id, { changes: [{ orderItemId: itemId, quantity: 1.5 }] })).rejects.toThrow(/whole numbers/);
      await expect(amend(o.id, { changes: [{ orderItemId: itemId, quantity: 0 }] })).rejects.toThrow(/cancel the order instead/);
      await expect(amend(o.id, { changes: [{ orderItemId: other.items[0].id, quantity: 6 }] })).rejects.toThrow(/not on this order/);
      await expect(amend(o.id, { additions: [{ productId: p, quantity: 0 }] })).rejects.toThrow(/greater than zero/);
      await expect(amend(o.id, { additions: [{ productId: "nope", quantity: 5 }] })).rejects.toThrow(/could not be found/);
      expect(await getStockBreakdown(p, prisma)).toMatchObject({ reserved: 10 }); // both orders, untouched
    });

    it("an amendment racing a payment ends consistent: either it landed before payment or was refused after", async () => {
      const p = await product(100);
      const o = await order("CONFIRMED", [{ productId: p, quantity: 4 }]);
      const [amended, paid] = await Promise.allSettled([
        amend(o.id, { changes: [{ orderItemId: o.items[0].id, quantity: 9 }] }),
        markOrderPaid(a(o.id)),
      ]);
      expect(paid.status).toBe("fulfilled"); // payment always succeeds from CONFIRMED
      const stored = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { items: true } });
      expect(stored.status).toBe("PAID");
      expect(stored.totalCents).toBe(stored.items.reduce((sum, i) => sum + i.quantity * i.unitPriceCents, 0));
      await expectReservedMatchesLines(o, p);
      if (amended.status === "rejected") expect(stored.items[0].quantity).toBe(4);
      else expect(stored.items[0].quantity).toBe(9);
    });

    it("cancelling after an amendment releases exactly the amended quantity", async () => {
      const p = await product(100);
      const o = await order("CONFIRMED", [{ productId: p, quantity: 4 }]);
      await amend(o.id, { changes: [{ orderItemId: o.items[0].id, quantity: 9 }] });
      await cancelOrder({ ...a(o.id), actorRole: "OWNER" });
      expect(await getStockBreakdown(p, prisma)).toEqual({ physical: 100, reserved: 0, damaged: 0, available: 100 });
    });
  });
});
