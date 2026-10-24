import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { phoneKeyOf } from "@/lib/phone";
import { recordStockMovement } from "@/lib/stock";
import { StockMovementReason } from "@prisma/client";
import { createDraftOrder, confirmOrder } from "@/lib/orders";
import { buildPaymentReference } from "@/lib/payments";
import {
  PLAN_LIMITS,
  TRIAL_DAYS,
  startTrial,
  isTrialExpired,
  currentBillingPeriod,
  getUsage,
  getEntitlementStatus,
  buildSubscriptionPaymentReference,
  parseSubscriptionPaymentReference,
  recordSubscriptionPayment,
} from "@/lib/billing";
import { POST as paystackWebhook } from "@/app/api/webhooks/paystack/route";

describe("startTrial / isTrialExpired", () => {
  let organizationId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "Billing Trial Test Org" } });
    organizationId = org.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("starts a trial on the starter plan with a trialEndsAt roughly TRIAL_DAYS out", async () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const before = Date.now();
    const org = await startTrial(organizationId);
    const after = Date.now();
    expect(org.plan).toBe("STARTER");
    expect(org.subscriptionStatus).toBe("TRIALING");
    expect(org.trialEndsAt).not.toBeNull();
    // startTrial takes its own Date.now() reading strictly between `before` and `after`, so
    // trialEndsAt is bounded by TRIAL_DAYS out from each end — unlike comparing against a single
    // `before` timestamp, this holds regardless of how much time the call itself takes.
    const trialEndsAtMs = org.trialEndsAt!.getTime();
    expect(trialEndsAtMs).toBeGreaterThanOrEqual(before + TRIAL_DAYS * DAY_MS);
    expect(trialEndsAtMs).toBeLessThanOrEqual(after + TRIAL_DAYS * DAY_MS);
  });

  it("is not expired while trialEndsAt is in the future", () => {
    expect(isTrialExpired({ subscriptionStatus: "TRIALING", trialEndsAt: new Date(Date.now() + 1000) })).toBe(false);
  });

  it("is expired once trialEndsAt is in the past", () => {
    expect(isTrialExpired({ subscriptionStatus: "TRIALING", trialEndsAt: new Date(Date.now() - 1000) })).toBe(true);
  });

  it("is never expired for a non-trialing status, regardless of trialEndsAt", () => {
    expect(isTrialExpired({ subscriptionStatus: "ACTIVE", trialEndsAt: new Date(Date.now() - 1000) })).toBe(false);
  });

  it("is never expired when there is no trialEndsAt at all", () => {
    expect(isTrialExpired({ subscriptionStatus: "TRIALING", trialEndsAt: null })).toBe(false);
  });
});

describe("subscription payment reference round trip", () => {
  it("parses exactly what it built, plan included", () => {
    const reference = buildSubscriptionPaymentReference("org123", "GROWTH");
    expect(parseSubscriptionPaymentReference(reference)).toEqual({ organizationId: "org123", plan: "GROWTH" });
  });

  it("two references for the same org/plan are never the same string", () => {
    const a = buildSubscriptionPaymentReference("org1", "STARTER");
    const b = buildSubscriptionPaymentReference("org1", "STARTER");
    expect(a).not.toBe(b);
  });

  it("refuses anything that doesn't match the shape, rather than guessing", () => {
    expect(parseSubscriptionPaymentReference("not-a-reference")).toBeNull();
    expect(parseSubscriptionPaymentReference("subpay_org_starter")).toBeNull(); // no nonce
    expect(parseSubscriptionPaymentReference("subpay_org_notaplan_abcdef123456")).toBeNull();
    expect(parseSubscriptionPaymentReference("")).toBeNull();
    // never confused with an order-payment reference
    expect(parseSubscriptionPaymentReference(buildPaymentReference("org1", "order1"))).toBeNull();
  });
});

describe("getUsage / getEntitlementStatus", () => {
  let organizationId: string;
  let userId: string;
  let customerId: string;
  let productId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "Billing Usage Test Org", plan: "STARTER" } });
    organizationId = org.id;

    const user = await prisma.user.create({
      data: { memberships: { create: { organizationId, role: "OWNER" } }, email: "billing-usage-test@example.com", passwordHash: "x", name: "Owner" },
    });
    userId = user.id;

    const phone = "+15557770010";
    customerId = (await prisma.customer.create({ data: { organizationId, phone, phoneKey: phoneKeyOf(phone)!, name: "Billing Usage Customer" } })).id;

    const product = await prisma.product.create({ data: { organizationId, sku: "BILL-TEST-1", name: "Billing Test Product", priceCents: 10000 } });
    productId = product.id;
    await recordStockMovement({ organizationId, productId, quantityDelta: 100, reason: StockMovementReason.INITIAL_STOCK });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("derives staff seats from membership count, not a stored counter", async () => {
    const period = currentBillingPeriod();
    const before = await getUsage(organizationId, period);
    expect(before.staffSeats).toBe(1);

    const secondUser = await prisma.user.create({
      data: { memberships: { create: { organizationId, role: "STAFF" } }, email: "billing-usage-staff@example.com", passwordHash: "x", name: "Staff" },
    });
    const after = await getUsage(organizationId, period);
    expect(after.staffSeats).toBe(2);

    await prisma.membership.deleteMany({ where: { userId: secondUser.id } });
    await prisma.user.delete({ where: { id: secondUser.id } });
  });

  it("derives orders this period from real Order rows", async () => {
    const period = currentBillingPeriod();
    const before = await getUsage(organizationId, period);

    const order = await createDraftOrder({ organizationId, customerId, createdById: userId, items: [{ productId, quantity: 1 }] });
    await confirmOrder({ organizationId, orderId: order.id, actorId: userId, allowDuplicate: true });

    const after = await getUsage(organizationId, period);
    expect(after.ordersThisPeriod).toBe(before.ordersThisPeriod + 1);
  });

  it("flags over-limit metrics as informational only, never throwing or blocking", async () => {
    // Starter's staff-seat limit is small; push past it and confirm the check is purely informational.
    const extraUsers = await Promise.all(
      Array.from({ length: PLAN_LIMITS.STARTER.staffSeats + 2 }).map((_, i) =>
        prisma.user.create({
          data: {
            memberships: { create: { organizationId, role: "STAFF" } },
            email: `billing-overlimit-${i}@example.com`,
            passwordHash: "x",
            name: `Staff ${i}`,
          },
        })
      )
    );

    const status = await getEntitlementStatus(organizationId);
    expect(status.plan).toBe("STARTER");
    expect(status.overLimit.staffSeats).toBe(true);
    // Nothing about exceeding a limit throws or alters plan/usage data — it's purely reported.
    expect(status.usage.staffSeats).toBeGreaterThan(status.limits.staffSeats);

    await prisma.membership.deleteMany({ where: { userId: { in: extraUsers.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: extraUsers.map((u) => u.id) } } });
  });
});

describe("recordSubscriptionPayment", () => {
  let organizationId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Billing Payment Test Org", plan: "STARTER", subscriptionStatus: "TRIALING" },
    });
    organizationId = org.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("writes a SubscriptionPayment row and activates the organization on that plan", async () => {
    const reference = buildSubscriptionPaymentReference(organizationId, "GROWTH");
    const payment = await recordSubscriptionPayment({
      organizationId,
      plan: "GROWTH",
      amountCents: PLAN_LIMITS.GROWTH.monthlyFeeCents,
      providerReference: reference,
    });
    expect(payment).not.toBeNull();
    expect(payment).toMatchObject({ plan: "GROWTH", amountCents: PLAN_LIMITS.GROWTH.monthlyFeeCents });

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    expect(org.plan).toBe("GROWTH");
    expect(org.subscriptionStatus).toBe("ACTIVE");
    expect(org.currentPeriodEnd).not.toBeNull();
  });

  it("is idempotent by providerReference — a redelivered webhook is a silent no-op", async () => {
    const reference = buildSubscriptionPaymentReference(organizationId, "GROWTH");
    const first = await recordSubscriptionPayment({ organizationId, plan: "GROWTH", amountCents: 1, providerReference: reference });
    expect(first).not.toBeNull();

    const second = await recordSubscriptionPayment({ organizationId, plan: "GROWTH", amountCents: 1, providerReference: reference });
    expect(second).toBeNull();

    const count = await prisma.subscriptionPayment.count({ where: { providerReference: reference } });
    expect(count).toBe(1);
  });

  it("captures a reusable card authorization code when the charge carried one — raw material for a future tokenized subscription", async () => {
    const org = await prisma.organization.create({ data: { name: "Billing Auth Capture Test Org" } });
    const reference = buildSubscriptionPaymentReference(org.id, "STARTER");
    await recordSubscriptionPayment({
      organizationId: org.id,
      plan: "STARTER",
      amountCents: PLAN_LIMITS.STARTER.monthlyFeeCents,
      providerReference: reference,
      authorizationCode: "AUTH_capture_test",
    });
    const updated = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(updated.paystackAuthorizationCode).toBe("AUTH_capture_test");
  });

  it("leaves any previously captured authorization code untouched when this charge didn't carry one", async () => {
    const org = await prisma.organization.create({ data: { name: "Billing Auth Keep Test Org", paystackAuthorizationCode: "AUTH_keep_me" } });
    await recordSubscriptionPayment({
      organizationId: org.id,
      plan: "STARTER",
      amountCents: PLAN_LIMITS.STARTER.monthlyFeeCents,
      providerReference: buildSubscriptionPaymentReference(org.id, "STARTER"),
      // authorizationCode omitted — e.g. a renewal paid by bank transfer, no reusable card involved
    });
    const updated = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(updated.paystackAuthorizationCode).toBe("AUTH_keep_me");
  });
});

describe("Paystack webhook route dispatches order vs subscription payments correctly", () => {
  const PAYSTACK_SECRET = "route-billing-paystack-secret";

  function sign(body: string) {
    return crypto.createHmac("sha512", PAYSTACK_SECRET).update(body, "utf8").digest("hex");
  }

  function post(body: string) {
    return paystackWebhook(
      new NextRequest("http://localhost/api/webhooks/paystack", {
        method: "POST",
        body,
        headers: { "x-paystack-signature": sign(body) },
      })
    );
  }

  let organizationId: string;
  let orderId: string;
  let orderTotalCents: number;

  beforeAll(async () => {
    process.env.PAYSTACK_SECRET_KEY = PAYSTACK_SECRET;
    const org = await prisma.organization.create({ data: { name: "Billing Webhook Dispatch Test Org" } });
    organizationId = org.id;
    const user = await prisma.user.create({
      data: { memberships: { create: { organizationId, role: "OWNER" } }, email: "billing-webhook-test@example.com", passwordHash: "x", name: "Owner" },
    });
    const phone = "+15557770020";
    const customer = await prisma.customer.create({ data: { organizationId, phone, phoneKey: phoneKeyOf(phone)!, name: "Webhook Dispatch Customer" } });
    const product = await prisma.product.create({ data: { organizationId, sku: "BILL-ROUTE-1", name: "Route Product", priceCents: 25000 } });
    await recordStockMovement({ organizationId, productId: product.id, quantityDelta: 10, reason: StockMovementReason.INITIAL_STOCK });
    const order = await createDraftOrder({ organizationId, customerId: customer.id, createdById: user.id, items: [{ productId: product.id, quantity: 1 }] });
    await confirmOrder({ organizationId, orderId: order.id, actorId: user.id, allowDuplicate: true });
    orderId = order.id;
    orderTotalCents = 25000;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("a subpay_ reference is applied as a subscription payment, never as an order payment", async () => {
    const reference = buildSubscriptionPaymentReference(organizationId, "SCALE");
    const body = JSON.stringify({ event: "charge.success", data: { reference, amount: PLAN_LIMITS.SCALE.monthlyFeeCents, status: "success" } });
    const res = await post(body);
    expect(res.status).toBe(200);

    const subPayment = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { providerReference: reference } });
    expect(subPayment.plan).toBe("SCALE");

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    expect(org.plan).toBe("SCALE");
    expect(org.subscriptionStatus).toBe("ACTIVE");

    // The order payment ledger is untouched by a subscription charge.
    expect(await prisma.payment.count({ where: { orderId } })).toBe(0);
  });

  it("threads a reusable card authorization from the webhook event through to the organization", async () => {
    // Uses GROWTH, not STARTER — a sibling test in this block asserts the STARTER subscription
    // payment count stays at zero for this same shared organization fixture.
    const reference = buildSubscriptionPaymentReference(organizationId, "GROWTH");
    const body = JSON.stringify({
      event: "charge.success",
      data: { reference, amount: PLAN_LIMITS.GROWTH.monthlyFeeCents, status: "success", authorization: { authorization_code: "AUTH_via_webhook", reusable: true } },
    });
    const res = await post(body);
    expect(res.status).toBe(200);

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    expect(org.paystackAuthorizationCode).toBe("AUTH_via_webhook");
  });

  it("a pay_ reference still routes to the order-payment path, same endpoint", async () => {
    const reference = buildPaymentReference(organizationId, orderId);
    const body = JSON.stringify({ event: "charge.success", data: { reference, amount: orderTotalCents, status: "success" } });
    const res = await post(body);
    expect(res.status).toBe(200);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(updated.status).toBe("PAID");
    expect(await prisma.subscriptionPayment.count({ where: { organizationId, plan: "STARTER" } })).toBe(0);
  });
});
