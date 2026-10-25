import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", () => {
  return {
    default: vi.fn().mockImplementation(function MockOpenAI(this: { chat: { completions: { create: typeof mockCreate } } }) {
      this.chat = { completions: { create: mockCreate } };
    }),
  };
});

function toolCallMessage(calls: { id: string; name: string; input: unknown }[]) {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) } })),
        },
      },
    ],
  };
}

function textMessage(text: string) {
  return { choices: [{ message: { role: "assistant", content: text, tool_calls: undefined } }] };
}

import { prisma } from "@/lib/prisma";
import { StockMovementReason } from "@prisma/client";
import { recordStockMovement, getProductStock, getStockBreakdown } from "@/lib/stock";
import { confirmOrder, markOrderPaid, markOrderFulfilled } from "@/lib/orders";
import { runAIAssist } from "@/lib/ai/engine";
import { POST as webhookPost } from "@/app/api/webhooks/whatsapp/route";

const APP_SECRET = "e2e-test-secret";

function sign(body: string) {
  return `sha256=${crypto.createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex")}`;
}

/**
 * Proves the whole Phase 1 pipeline composes end to end, not just each
 * piece in isolation: a real WhatsApp webhook POST creates the conversation,
 * the AI engine (OpenAI client mocked, everything else real) searches the
 * real catalogue and drafts a real order from it, and that order is then
 * taken all the way through confirm -> paid -> fulfilled using the exact
 * same order-lifecycle functions a staff-created order uses — with stock
 * genuinely reserved once, at confirmation, and never double-counted.
 */
describe("end-to-end: WhatsApp message -> AI draft -> confirm -> paid -> fulfilled", () => {
  let organizationId: string;
  let userId: string;
  let productId: string;

  beforeAll(async () => {
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;

    // The webhook route resolves the (single, Phase-1-scoped) organization
    // via `findFirst()` — correct for real single-tenant usage, but this
    // test needs to be the *only* organization in the shared test database
    // for that lookup to deterministically land on its own fixtures, rather
    // than whichever other test file happened to create an org first. All
    // other test files have finished their own assertions by the time this
    // file runs (fileParallelism is off), so a full reset here is safe.
    await prisma.auditLog.deleteMany();
    await prisma.stockMovement.deleteMany();
    await prisma.customerMerge.deleteMany();
    await prisma.customerPrice.deleteMany();
    await prisma.customerAddress.deleteMany();
    await prisma.shipmentItem.deleteMany();
    await prisma.shipment.deleteMany();
    await prisma.returnItem.deleteMany();
    await prisma.orderReturn.deleteMany();
    await prisma.subscriptionPayment.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.messageAttachment.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.priceTier.deleteMany();
    await prisma.productImage.deleteMany();
    await prisma.product.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.user.deleteMany();
    await prisma.organization.deleteMany();

    const org = await prisma.organization.create({ data: { name: "E2E Flow Test Org" } });
    organizationId = org.id;

    const user = await prisma.user.create({
      data: { memberships: { create: { organizationId, role: "STAFF" } }, email: "e2e-test@example.com", passwordHash: "x", name: "E2E Staff" },
    });
    userId = user.id;

    const product = await prisma.product.create({
      data: {
        organizationId,
        sku: "E2E-ANK-BLK-M",
        name: "Ankara Two-Piece Set",
        variantAttributes: { colour: "Black", size: "M" },
        priceCents: 1850000,
      },
    });
    productId = product.id;
    await recordStockMovement({
      organizationId,
      productId,
      quantityDelta: 5,
      reason: StockMovementReason.INITIAL_STOCK,
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    mockCreate.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("runs the full pipeline and leaves an accurate, fully-reconciled trail", async () => {
    // 1. A real WhatsApp webhook delivers the customer's enquiry.
    const webhookBody = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                contacts: [{ profile: { name: "E2E Customer" }, wa_id: "15557778888" }],
                messages: [
                  {
                    from: "15557778888",
                    id: "wamid.e2e-1",
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: "text",
                    text: { body: "2 black ankara two-piece sets, medium, how much?" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const webhookRes = await webhookPost(
      new NextRequest("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        body: webhookBody,
        headers: { "x-hub-signature-256": sign(webhookBody) },
      })
    );
    expect(webhookRes.status).toBe(200);

    const customer = await prisma.customer.findFirstOrThrow({ where: { phoneKey: "15557778888" } });
    const conversation = await prisma.conversation.findFirstOrThrow({
      where: { organizationId, customerId: customer.id },
    });
    expect(conversation.status).toBe("NEW");

    // 2. Staff clicks "Let AI respond" — the model is mocked, but it drives
    // the real search_catalogue and create_draft_order tools.
    mockCreate
      .mockResolvedValueOnce(toolCallMessage([{ id: "tu1", name: "search_catalogue", input: { query: "black ankara two-piece medium" } }]))
      .mockResolvedValueOnce(toolCallMessage([{ id: "tu2", name: "create_draft_order", input: { items: [{ productId, quantity: 2 }] } }]))
      .mockResolvedValueOnce(textMessage("I've drafted an order for 2 — a staff member will confirm shortly."));

    const aiResult = await runAIAssist({
      organizationId,
      conversationId: conversation.id,
      customerId: customer.id,
      createdById: userId,
    });
    expect(aiResult.draftOrder).toBeDefined();

    const stockAfterDraft = await getProductStock(productId, prisma);
    expect(stockAfterDraft).toBe(5); // drafting never touches stock

    // 3. Staff takes the AI-drafted order through the same lifecycle a
    // manually-created order would go through.
    await confirmOrder({ organizationId, orderId: aiResult.draftOrder!.id, actorId: userId });
    expect(await getProductStock(productId, prisma)).toBe(3); // reserved exactly once, at confirm
    expect(await getStockBreakdown(productId, prisma)).toEqual({ physical: 5, reserved: 2, damaged: 0, available: 3 });

    await markOrderPaid({ organizationId, orderId: aiResult.draftOrder!.id, actorId: userId });
    await markOrderFulfilled({ organizationId, orderId: aiResult.draftOrder!.id, actorId: userId });

    const finalOrder = await prisma.order.findUniqueOrThrow({
      where: { id: aiResult.draftOrder!.id },
      include: { items: true },
    });
    expect(finalOrder.status).toBe("FULFILLED");
    expect(finalOrder.conversationId).toBe(conversation.id);
    expect(finalOrder.totalCents).toBe(2 * 1850000);
    expect(await getProductStock(productId, prisma)).toBe(3); // still correct — nothing double-counted
    // Shipping moved the 2 units out of physical and reserved together.
    expect(await getStockBreakdown(productId, prisma)).toEqual({ physical: 3, reserved: 0, damaged: 0, available: 3 });

    // 4. The audit trail reconciles with the ledger: one reservation
    // movement, matching exactly the order's confirmed quantity.
    const movements = await prisma.stockMovement.findMany({
      where: { productId, reason: StockMovementReason.SALE_RESERVED },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ physicalDelta: 0, reservedDelta: 2, damagedDelta: 0 });
    expect(movements[0].reference).toBe(finalOrder.reference);

    const shipments = await prisma.stockMovement.findMany({
      where: { productId, reason: StockMovementReason.SALE_FULFILLED },
    });
    expect(shipments).toHaveLength(1);
    expect(shipments[0]).toMatchObject({ physicalDelta: -2, reservedDelta: -2, damagedDelta: 0 });

    const auditEntries = await prisma.auditLog.findMany({
      where: { organizationId, entity: "Order", entityId: finalOrder.id },
      orderBy: { createdAt: "asc" },
    });
    expect(auditEntries.map((a) => a.action)).toEqual([
      "ORDER_DRAFTED",
      "ORDER_CONFIRMED",
      "PAYMENT_MARKED_PAID",
      "ORDER_FULFILLED",
    ]);
  });
});
