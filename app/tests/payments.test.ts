import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { phoneKeyOf } from "@/lib/phone";
import { recordStockMovement } from "@/lib/stock";
import { StockMovementReason } from "@prisma/client";
import { createDraftOrder, confirmOrder, markOrderPaid, OrderStateError } from "@/lib/orders";
import {
  verifyPaystackSignature,
  buildPaymentReference,
  parsePaymentReference,
  parsePaystackWebhookEvent,
  recordManualPayment,
  recordProviderPayment,
  getPaidCents,
  PaymentError,
} from "@/lib/payments";
import { transaction } from "@/lib/db";
import { POST as paystackWebhook } from "@/app/api/webhooks/paystack/route";

const SECRET = "paystack-test-secret";

function sign(body: string) {
  return crypto.createHmac("sha512", SECRET).update(body, "utf8").digest("hex");
}

describe("verifyPaystackSignature", () => {
  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = SECRET;
  });

  it("accepts a correctly signed body", () => {
    const body = JSON.stringify({ hello: "world" });
    expect(verifyPaystackSignature(body, sign(body))).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = JSON.stringify({ hello: "world" });
    const signature = sign(body);
    expect(verifyPaystackSignature(JSON.stringify({ hello: "mallory" }), signature)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyPaystackSignature(JSON.stringify({ a: 1 }), null)).toBe(false);
  });

  it("rejects when the secret key isn't configured", () => {
    const body = JSON.stringify({ a: 1 });
    const signature = sign(body);
    delete process.env.PAYSTACK_SECRET_KEY;
    expect(verifyPaystackSignature(body, signature)).toBe(false);
  });
});

describe("payment reference round trip", () => {
  it("parses exactly what it built", () => {
    const reference = buildPaymentReference("org123", "order456");
    expect(parsePaymentReference(reference)).toEqual({ organizationId: "org123", orderId: "order456" });
  });

  it("two references for the same order are never the same string", () => {
    const a = buildPaymentReference("org1", "order1");
    const b = buildPaymentReference("org1", "order1");
    expect(a).not.toBe(b);
  });

  it("refuses anything that doesn't match the shape, rather than guessing", () => {
    expect(parsePaymentReference("not-a-reference")).toBeNull();
    expect(parsePaymentReference("pay_org_order")).toBeNull(); // no nonce
    expect(parsePaymentReference("")).toBeNull();
    expect(parsePaymentReference("PAYSTACK_AUTO_GENERATED_REF_123")).toBeNull(); // a reference we never issued
  });
});

describe("parsePaystackWebhookEvent", () => {
  it("extracts the fields this app acts on", () => {
    const event = parsePaystackWebhookEvent({ event: "charge.success", data: { reference: "pay_a_b_c", amount: 50000, status: "success" } });
    expect(event).toEqual({ event: "charge.success", reference: "pay_a_b_c", amountCents: 50000, status: "success", authorizationCode: null });
  });

  it("returns null for a malformed or unrelated payload", () => {
    expect(parsePaystackWebhookEvent(null)).toBeNull();
    expect(parsePaystackWebhookEvent({ event: "charge.success" })).toBeNull(); // no data
    expect(parsePaystackWebhookEvent({ event: "charge.success", data: { reference: "x" } })).toBeNull(); // no amount
  });

  it("extracts a reusable card authorization code, but never a non-reusable one", () => {
    const withAuth = parsePaystackWebhookEvent({
      event: "charge.success",
      data: { reference: "pay_a_b_c", amount: 50000, status: "success", authorization: { authorization_code: "AUTH_abc123", reusable: true } },
    });
    expect(withAuth?.authorizationCode).toBe("AUTH_abc123");

    const nonReusable = parsePaystackWebhookEvent({
      event: "charge.success",
      data: { reference: "pay_a_b_c", amount: 50000, status: "success", authorization: { authorization_code: "AUTH_abc123", reusable: false } },
    });
    expect(nonReusable?.authorizationCode).toBeNull();
  });
});

describe("recordManualPayment / recordProviderPayment", () => {
  let organizationId: string;
  let otherOrganizationId: string;
  let userId: string;
  let customerId: string;
  let productId: string;

  async function newOrder(quantity = 1) {
    const order = await createDraftOrder({ organizationId, customerId, createdById: userId, items: [{ productId, quantity }] });
    await confirmOrder({ organizationId, orderId: order.id, actorId: userId, allowDuplicate: true });
    return prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  }

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "Payments Test Org" } });
    organizationId = org.id;
    otherOrganizationId = (await prisma.organization.create({ data: { name: "Payments Test Other Org" } })).id;

    const user = await prisma.user.create({
      data: { memberships: { create: { organizationId, role: "OWNER" } }, email: "payments-test@example.com", passwordHash: "x", name: "Owner" },
    });
    userId = user.id;

    const phone = "+15557770000";
    customerId = (await prisma.customer.create({ data: { organizationId, phone, phoneKey: phoneKeyOf(phone)!, name: "Payments Customer" } })).id;

    const product = await prisma.product.create({ data: { organizationId, sku: "PAY-TEST-1", name: "Payments Test Product", priceCents: 10000 } });
    productId = product.id;
    await recordStockMovement({ organizationId, productId, quantityDelta: 100, reason: StockMovementReason.INITIAL_STOCK });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("a manual payment for the full amount marks the order paid", async () => {
    const order = await newOrder(1); // 10000 cents
    await recordManualPayment({ organizationId, orderId: order.id, amountCents: 10000, actorId: userId });
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe("PAID");
    expect(updated.paidAt).not.toBeNull();
  });

  it("a partial manual payment leaves the order confirmed, not paid", async () => {
    const order = await newOrder(2); // 20000 cents
    await recordManualPayment({ organizationId, orderId: order.id, amountCents: 5000, actorId: userId });
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe("CONFIRMED");
    const paid = await transaction(organizationId, (tx) => getPaidCents(tx, order.id));
    expect(paid).toBe(5000);
  });

  it("two partial payments that together cover the total transition it to paid", async () => {
    const order = await newOrder(2); // 20000 cents
    await recordManualPayment({ organizationId, orderId: order.id, amountCents: 12000, actorId: userId });
    await recordManualPayment({ organizationId, orderId: order.id, amountCents: 8000, actorId: userId });
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe("PAID");
  });

  it("refuses a zero or negative amount", async () => {
    const order = await newOrder(1);
    await expect(recordManualPayment({ organizationId, orderId: order.id, amountCents: 0, actorId: userId })).rejects.toBeInstanceOf(PaymentError);
    await expect(recordManualPayment({ organizationId, orderId: order.id, amountCents: -500, actorId: userId })).rejects.toBeInstanceOf(PaymentError);
  });

  it("refuses to record a payment against a draft order — nothing to pay yet", async () => {
    const draft = await createDraftOrder({ organizationId, customerId, createdById: userId, items: [{ productId, quantity: 1 }] });
    await expect(recordManualPayment({ organizationId, orderId: draft.id, amountCents: 1000, actorId: userId })).rejects.toBeInstanceOf(PaymentError);
  });

  it("a provider payment is idempotent by reference — a redelivered webhook event is a silent no-op", async () => {
    const order = await newOrder(1);
    const reference = buildPaymentReference(organizationId, order.id);
    const first = await recordProviderPayment({ organizationId, orderId: order.id, amountCents: 10000, providerReference: reference });
    expect(first?.paidInFullNow).toBe(true);

    const second = await recordProviderPayment({ organizationId, orderId: order.id, amountCents: 10000, providerReference: reference });
    expect(second).toBeNull();

    const paymentCount = await prisma.payment.count({ where: { orderId: order.id } });
    expect(paymentCount).toBe(1); // never double-recorded
  });

  it("overpayment is recorded, not rejected or silently capped — and stays visible as more than the total", async () => {
    const order = await newOrder(1); // 10000 cents
    await recordProviderPayment({ organizationId, orderId: order.id, amountCents: 10000, providerReference: buildPaymentReference(organizationId, order.id) });
    await recordProviderPayment({ organizationId, orderId: order.id, amountCents: 3000, providerReference: buildPaymentReference(organizationId, order.id) });

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe("PAID"); // already paid — the extra is overpayment, not a second transition
    const paid = await transaction(organizationId, (tx) => getPaidCents(tx, order.id));
    expect(paid).toBe(13000);
    expect(paid).toBeGreaterThan(updated.totalCents);
  });

  it("notifies the owners when a provider payment completes an order — never for a manual one", async () => {
    const order = await newOrder(1);
    await recordProviderPayment({ organizationId, orderId: order.id, amountCents: 10000, providerReference: buildPaymentReference(organizationId, order.id) });
    const notes = await prisma.notification.findMany({ where: { organizationId, userId } });
    expect(notes.some((n) => n.kind === "PAYMENT_VERIFIED" && n.title.includes(order.reference))).toBe(true);

    const manualOrder = await newOrder(1);
    const before = await prisma.notification.count({ where: { organizationId } });
    await recordManualPayment({ organizationId, orderId: manualOrder.id, amountCents: 10000, actorId: userId });
    const after = await prisma.notification.count({ where: { organizationId } });
    expect(after).toBe(before); // no notification for a manual payment
  });

  it("never applies a payment to another organization's order, even with a correctly-shaped reference", async () => {
    const order = await newOrder(1);
    await expect(
      recordProviderPayment({ organizationId: otherOrganizationId, orderId: order.id, amountCents: 10000, providerReference: buildPaymentReference(otherOrganizationId, order.id) })
    ).rejects.toBeInstanceOf(PaymentError);
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe("CONFIRMED"); // untouched
  });

  it("markOrderPaid still works exactly as before, now backed by the same ledger", async () => {
    const order = await newOrder(1);
    await markOrderPaid({ organizationId, orderId: order.id, actorId: userId });
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe("PAID");
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(payment).toMatchObject({ method: "MANUAL", amountCents: 10000, recordedById: userId });
    const auditEntry = await prisma.auditLog.findFirstOrThrow({ where: { entityId: order.id, action: "PAYMENT_MARKED_PAID" } });
    expect(auditEntry.actorId).toBe(userId);
  });

  it("markOrderPaid refuses an order that's already fully paid via a partial-payment path", async () => {
    const order = await newOrder(1);
    await recordManualPayment({ organizationId, orderId: order.id, amountCents: 10000, actorId: userId }); // pays it off, transitions to PAID
    await expect(markOrderPaid({ organizationId, orderId: order.id, actorId: userId })).rejects.toBeInstanceOf(OrderStateError);
  });
});

describe("Paystack webhook route", () => {
  const PAYSTACK_SECRET = "route-paystack-secret";

  function sign(body: string) {
    return crypto.createHmac("sha512", PAYSTACK_SECRET).update(body, "utf8").digest("hex");
  }

  function post(body: string, signatureHeader: string | null) {
    return paystackWebhook(
      new NextRequest("http://localhost/api/webhooks/paystack", {
        method: "POST",
        body,
        headers: signatureHeader ? { "x-paystack-signature": signatureHeader } : {},
      })
    );
  }

  let organizationId: string;
  let orderId: string;
  let orderTotalCents: number;

  beforeAll(async () => {
    process.env.PAYSTACK_SECRET_KEY = PAYSTACK_SECRET;
    const org = await prisma.organization.create({ data: { name: "Paystack Route Test Org" } });
    organizationId = org.id;
    const user = await prisma.user.create({
      data: { memberships: { create: { organizationId, role: "OWNER" } }, email: "paystack-route-test@example.com", passwordHash: "x", name: "Owner" },
    });
    const phone = "+15557770001";
    const customer = await prisma.customer.create({ data: { organizationId, phone, phoneKey: phoneKeyOf(phone)!, name: "Route Customer" } });
    const product = await prisma.product.create({ data: { organizationId, sku: "PAY-ROUTE-1", name: "Route Product", priceCents: 25000 } });
    await recordStockMovement({ organizationId, productId: product.id, quantityDelta: 10, reason: StockMovementReason.INITIAL_STOCK });
    const order = await createDraftOrder({ organizationId, customerId: customer.id, createdById: user.id, items: [{ productId: product.id, quantity: 1 }] });
    await confirmOrder({ organizationId, orderId: order.id, actorId: user.id, allowDuplicate: true });
    orderId = order.id;
    orderTotalCents = 25000;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects an incorrectly signed request", async () => {
    const body = JSON.stringify({ event: "charge.success", data: { reference: "x", amount: 1, status: "success" } });
    const res = await post(body, "deadbeef");
    expect(res.status).toBe(401);
  });

  it("applies a correctly signed charge.success event to the right order", async () => {
    const reference = buildPaymentReference(organizationId, orderId);
    const body = JSON.stringify({ event: "charge.success", data: { reference, amount: orderTotalCents, status: "success", currency: "NGN" } });
    const res = await post(body, sign(body));
    expect(res.status).toBe(200);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(updated.status).toBe("PAID");
    const payment = await prisma.payment.findUniqueOrThrow({ where: { providerReference: reference } });
    expect(payment).toMatchObject({ method: "PROVIDER", amountCents: orderTotalCents });
  });

  it("acknowledges but does not apply a non-success event", async () => {
    const reference = buildPaymentReference(organizationId, orderId);
    const body = JSON.stringify({ event: "charge.failed", data: { reference, amount: orderTotalCents, status: "failed" } });
    const res = await post(body, sign(body));
    expect(res.status).toBe(200);
    expect(await prisma.payment.count({ where: { providerReference: reference } })).toBe(0);
  });

  it("acknowledges but does not apply an event with a reference this app never issued", async () => {
    const body = JSON.stringify({ event: "charge.success", data: { reference: "some-other-system-ref-123", amount: orderTotalCents, status: "success" } });
    const res = await post(body, sign(body));
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/unrecognized reference/);
  });
});
