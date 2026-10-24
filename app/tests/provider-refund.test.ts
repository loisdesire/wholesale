import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ReturnItemCondition, StockMovementReason, UserRole } from "@prisma/client";
import { phoneKeyOf } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { recordStockMovement } from "@/lib/stock";
import { confirmOrder, createDraftOrder, markOrderFulfilled } from "@/lib/orders";
import { decideReturn, requestProviderRefund, requestReturn, ReturnPermissionError, ReturnStateError } from "@/lib/returns";
import { buildPaymentReference, recordManualPayment, recordProviderPayment, PaystackError } from "@/lib/payments";

describe("requestProviderRefund — automated refund via Paystack", () => {
  let organizationId: string;
  let owner: { id: string; role: UserRole };
  let staff: { id: string; role: UserRole };
  let n = 0;

  beforeAll(async () => {
    organizationId = (await prisma.organization.create({ data: { name: "Provider Refund Org" } })).id;
    const o = await prisma.user.create({
      data: { memberships: { create: { organizationId, role: "OWNER" } }, email: "pr-owner@example.com", passwordHash: "x", name: "Owner" },
    });
    const s = await prisma.user.create({
      data: { memberships: { create: { organizationId, role: "STAFF" } }, email: "pr-staff@example.com", passwordHash: "x", name: "Staff" },
    });
    owner = { id: o.id, role: "OWNER" };
    staff = { id: s.id, role: "STAFF" };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = "pr-test-secret";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function newCustomer() {
    n += 1;
    return (await prisma.customer.create({ data: { organizationId, phone: `+1889000${n}`, phoneKey: phoneKeyOf(`+1889000${n}`)!, name: `PR Customer ${n}` } })).id;
  }

  async function newProduct(stock: number, priceCents = 10000) {
    n += 1;
    const product = await prisma.product.create({ data: { organizationId, sku: `PR-${n}`, name: `PR Product ${n}`, priceCents } });
    await recordStockMovement({ organizationId, productId: product.id, quantityDelta: stock, reason: StockMovementReason.INITIAL_STOCK });
    return product.id;
  }

  /** A fulfilled order paid a given way, with a return already approved (refundStatus PENDING) for its full value. */
  async function fulfilledOrderWithPendingRefund(pay: (orderId: string, totalCents: number) => Promise<void>) {
    const customerId = await newCustomer();
    const productId = await newProduct(20);
    const order = await createDraftOrder({ organizationId, customerId, createdById: owner.id, items: [{ productId, quantity: 5 }] });
    await confirmOrder({ organizationId, orderId: order.id, actorId: owner.id });
    const full = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    await pay(order.id, full.totalCents);
    await markOrderFulfilled({ organizationId, orderId: order.id, actorId: owner.id });

    const requested = await requestReturn({
      organizationId,
      orderId: order.id,
      actor: staff,
      reason: "Wrong size",
      items: [{ orderItemId: full.items[0].id, quantity: 5, condition: ReturnItemCondition.RESELLABLE }],
    });
    await decideReturn({ organizationId, returnId: requested.id, actor: owner, approve: true });
    return requested.id;
  }

  it("refuses when Paystack isn't configured", async () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    const returnId = await fulfilledOrderWithPendingRefund((orderId, totalCents) =>
      recordProviderPayment({ organizationId, orderId, amountCents: totalCents, providerReference: buildPaymentReference(organizationId, orderId) }).then(() => {})
    );
    await expect(requestProviderRefund({ organizationId, returnId, actor: owner })).rejects.toBeInstanceOf(PaystackError);
  });

  it("only an owner can request a Paystack refund", async () => {
    const returnId = await fulfilledOrderWithPendingRefund((orderId, totalCents) =>
      recordProviderPayment({ organizationId, orderId, amountCents: totalCents, providerReference: buildPaymentReference(organizationId, orderId) }).then(() => {})
    );
    await expect(requestProviderRefund({ organizationId, returnId, actor: staff })).rejects.toBeInstanceOf(ReturnPermissionError);
  });

  it("refuses a return that isn't approved (no refund pending)", async () => {
    const customerId = await newCustomer();
    const productId = await newProduct(20);
    const order = await createDraftOrder({ organizationId, customerId, createdById: owner.id, items: [{ productId, quantity: 5 }] });
    await confirmOrder({ organizationId, orderId: order.id, actorId: owner.id });
    const full = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    await recordProviderPayment({ organizationId, orderId: order.id, amountCents: full.totalCents, providerReference: buildPaymentReference(organizationId, order.id) });
    await markOrderFulfilled({ organizationId, orderId: order.id, actorId: owner.id });
    const requested = await requestReturn({
      organizationId,
      orderId: order.id,
      actor: staff,
      reason: "Still deciding",
      items: [{ orderItemId: full.items[0].id, quantity: 5, condition: ReturnItemCondition.RESELLABLE }],
    });
    // Not decided yet — still REQUESTED, refundStatus NONE.
    await expect(requestProviderRefund({ organizationId, returnId: requested.id, actor: owner })).rejects.toBeInstanceOf(ReturnStateError);
  });

  it("refuses when the order wasn't paid through Paystack", async () => {
    const returnId = await fulfilledOrderWithPendingRefund((orderId, totalCents) =>
      recordManualPayment({ organizationId, orderId, amountCents: totalCents, actorId: owner.id }).then(() => {})
    );
    await expect(requestProviderRefund({ organizationId, returnId, actor: owner })).rejects.toThrow(
      /wasn't paid through Paystack/
    );
  });

  it("refuses when the order has more than one Paystack payment", async () => {
    const returnId = await fulfilledOrderWithPendingRefund(async (orderId, totalCents) => {
      const half = Math.floor(totalCents / 2);
      await recordProviderPayment({ organizationId, orderId, amountCents: half, providerReference: buildPaymentReference(organizationId, orderId) });
      await recordProviderPayment({ organizationId, orderId, amountCents: totalCents - half, providerReference: buildPaymentReference(organizationId, orderId) });
    });
    await expect(requestProviderRefund({ organizationId, returnId, actor: owner })).rejects.toThrow(/more than one Paystack payment/);
  });

  it("refuses when the refund is more than the original Paystack payment", async () => {
    const returnId = await fulfilledOrderWithPendingRefund(async (orderId, totalCents) => {
      // Paystack only covers part of the order; the rest came in by hand — one PROVIDER
      // payment, but smaller than the full-value refund the return is for.
      const providerShare = Math.floor(totalCents / 3);
      await recordProviderPayment({ organizationId, orderId, amountCents: providerShare, providerReference: buildPaymentReference(organizationId, orderId) });
      await recordManualPayment({ organizationId, orderId, amountCents: totalCents - providerShare, actorId: owner.id });
    });
    await expect(requestProviderRefund({ organizationId, returnId, actor: owner })).rejects.toThrow(
      /more than the original Paystack payment/
    );
  });

  it("requests the refund from Paystack and records it without marking the refund as paid", async () => {
    const returnId = await fulfilledOrderWithPendingRefund((orderId, totalCents) =>
      recordProviderPayment({ organizationId, orderId, amountCents: totalCents, providerReference: buildPaymentReference(organizationId, orderId) }).then(() => {})
    );

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: true, message: "Refund has been queued", data: { status: "pending" } }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestProviderRefund({ organizationId, returnId, actor: owner });
    expect(result.paystackStatus).toBe("pending");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.paystack.co/refund",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer pr-test-secret" }) })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.transaction).toMatch(/^pay_/);
    expect(body.amount).toBeGreaterThan(0);

    const ret = await prisma.orderReturn.findUniqueOrThrow({ where: { id: returnId } });
    expect(ret.refundStatus).toBe("PENDING"); // Paystack accepting it isn't the same as it being paid

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: ret.orderId, action: "REFUND_REQUESTED_PROVIDER" } });
    expect(audit.actorId).toBe(owner.id);
  });

  it("surfaces Paystack's own rejection message cleanly", async () => {
    const returnId = await fulfilledOrderWithPendingRefund((orderId, totalCents) =>
      recordProviderPayment({ organizationId, orderId, amountCents: totalCents, providerReference: buildPaymentReference(organizationId, orderId) }).then(() => {})
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: false, message: "Transaction already fully refunded" }), { status: 200 }))
    );

    await expect(requestProviderRefund({ organizationId, returnId, actor: owner })).rejects.toThrow(/already fully refunded/);

    const ret = await prisma.orderReturn.findUniqueOrThrow({ where: { id: returnId } });
    expect(ret.refundStatus).toBe("PENDING"); // the failed attempt left no evidence either
  });
});
