import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { phoneKeyOf } from "@/lib/phone";
import { recordStockMovement } from "@/lib/stock";
import { StockMovementReason } from "@prisma/client";
import { createDraftOrder, confirmOrder } from "@/lib/orders";
import { buildPaymentReference, recordProviderPayment, PaystackError } from "@/lib/payments";
import { buildSubscriptionPaymentReference, recordSubscriptionPayment, PLAN_LIMITS } from "@/lib/billing";
import { reconcileProviderPayments } from "@/lib/reconciliation";

function paystackTransactionsResponse(data: { reference: string; amount: number; status?: string; paid_at?: string | null }[]) {
  return new Response(
    JSON.stringify({ status: true, message: "Transactions retrieved", data: data.map((d) => ({ status: "success", paid_at: new Date().toISOString(), ...d })) }),
    { status: 200 }
  );
}

describe("reconcileProviderPayments", () => {
  let organizationId: string;
  let otherOrganizationId: string;
  let userId: string;
  let customerId: string;
  let productId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "Reconciliation Test Org" } });
    organizationId = org.id;
    otherOrganizationId = (await prisma.organization.create({ data: { name: "Reconciliation Other Org" } })).id;

    const user = await prisma.user.create({
      data: { memberships: { create: { organizationId, role: "OWNER" } }, email: "reconciliation-test@example.com", passwordHash: "x", name: "Owner" },
    });
    userId = user.id;

    const phone = "+15557770030";
    customerId = (await prisma.customer.create({ data: { organizationId, phone, phoneKey: phoneKeyOf(phone)!, name: "Reconciliation Customer" } })).id;

    const product = await prisma.product.create({ data: { organizationId, sku: "RECON-TEST-1", name: "Reconciliation Test Product", priceCents: 10000 } });
    productId = product.id;
    await recordStockMovement({ organizationId, productId, quantityDelta: 100, reason: StockMovementReason.INITIAL_STOCK });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = "recon-test-secret";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function paidOrderWithProviderPayment(amountCents = 10000) {
    const order = await createDraftOrder({ organizationId, customerId, createdById: userId, items: [{ productId, quantity: 1 }] });
    await confirmOrder({ organizationId, orderId: order.id, actorId: userId, allowDuplicate: true });
    const reference = buildPaymentReference(organizationId, order.id);
    await recordProviderPayment({ organizationId, orderId: order.id, amountCents, providerReference: reference });
    return reference;
  }

  it("refuses when Paystack isn't configured", async () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    await expect(reconcileProviderPayments(organizationId)).rejects.toBeInstanceOf(PaystackError);
  });

  it("reports no discrepancies when every matching Paystack transaction is recorded with the right amount", async () => {
    const reference = await paidOrderWithProviderPayment(10000);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(paystackTransactionsResponse([{ reference, amount: 10000 }])));

    const result = await reconcileProviderPayments(organizationId);
    expect(result.matchingThisOrganization).toBe(1);
    expect(result.discrepancies).toEqual([]);
  });

  it("flags a Paystack-confirmed charge that was never recorded locally", async () => {
    const phantomReference = buildPaymentReference(organizationId, "someorderid");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(paystackTransactionsResponse([{ reference: phantomReference, amount: 5000 }])));

    const result = await reconcileProviderPayments(organizationId);
    expect(result.discrepancies).toEqual([
      expect.objectContaining({ kind: "MISSING_LOCALLY", reference: phantomReference, amountCents: 5000 }),
    ]);
  });

  it("flags an amount mismatch between Paystack and what was recorded", async () => {
    const reference = await paidOrderWithProviderPayment(10000);
    // Paystack says 12000 was actually charged — different from the 10000 we recorded.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(paystackTransactionsResponse([{ reference, amount: 12000 }])));

    const result = await reconcileProviderPayments(organizationId);
    expect(result.discrepancies).toEqual([
      expect.objectContaining({ kind: "AMOUNT_MISMATCH", reference, recordedAmountCents: 10000, paystackAmountCents: 12000 }),
    ]);
  });

  it("includes subscription payments in the comparison", async () => {
    const reference = buildSubscriptionPaymentReference(organizationId, "GROWTH");
    await recordSubscriptionPayment({ organizationId, plan: "GROWTH", amountCents: PLAN_LIMITS.GROWTH.monthlyFeeCents, providerReference: reference });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(paystackTransactionsResponse([{ reference, amount: PLAN_LIMITS.GROWTH.monthlyFeeCents }])));

    const result = await reconcileProviderPayments(organizationId);
    expect(result.discrepancies).toEqual([]);
  });

  it("never attributes another organization's Paystack transactions to this one", async () => {
    const mine = await paidOrderWithProviderPayment(10000);
    const theirs = buildPaymentReference(otherOrganizationId, "theirorderid");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(paystackTransactionsResponse([{ reference: mine, amount: 10000 }, { reference: theirs, amount: 99999 }]))
    );

    const result = await reconcileProviderPayments(organizationId);
    expect(result.paystackTransactionsChecked).toBe(2);
    expect(result.matchingThisOrganization).toBe(1);
    expect(result.discrepancies).toEqual([]); // the other org's transaction is simply not this org's concern
  });

  it("pages through Paystack's transaction list until a short page ends it", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({ reference: `pay_${organizationId}_filler${i}_000000000000`, amount: 1 }));
    const shortPage = [{ reference: buildPaymentReference(organizationId, "lastorder"), amount: 7000 }];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(paystackTransactionsResponse(fullPage))
      .mockResolvedValueOnce(paystackTransactionsResponse(shortPage));
    vi.stubGlobal("fetch", fetchMock);

    const result = await reconcileProviderPayments(organizationId);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.paystackTransactionsChecked).toBe(101);
  });
});
