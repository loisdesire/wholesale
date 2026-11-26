import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function MockOpenAI(this: { chat: { completions: { create: typeof mockCreate } } }) {
    this.chat = { completions: { create: mockCreate } };
  }),
}));

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
const textMessage = (text: string) => ({ choices: [{ message: { role: "assistant", content: text, tool_calls: undefined } }] });

import { StockMovementReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { phoneKeyOf } from "@/lib/phone";
import { recordStockMovement } from "@/lib/stock";
import { confirmOrder, createDraftOrder, markOrderPaid, shipOrderItems } from "@/lib/orders";
import { runAIAssist } from "@/lib/ai/engine";
import { catalogueEntryForModel, formatMoneyExact, mergeItems, sameItems, sameProducts } from "@/lib/ai/order-context";

type ToolMessage = { role: string; tool_call_id?: string; content?: unknown };

/** The `content` of the tool message the model was handed back for the given call id, across every request made. */
function toolResult(callId: string): string {
  for (const [request] of mockCreate.mock.calls) {
    const found = (request.messages as ToolMessage[]).find((m) => m.role === "tool" && m.tool_call_id === callId);
    if (found) return String(found.content);
  }
  throw new Error(`no tool result for ${callId}`);
}

describe("AI order context: prices as text, no duplicate drafts, order lookups", () => {
  let organizationId: string;
  let userId: string;
  let headwrapId: string;
  let gownId: string;
  let n = 0;

  beforeAll(async () => {
    organizationId = (await prisma.organization.create({ data: { name: "Spice & Thread Traders" } })).id;
    userId = (
      await prisma.user.create({
        data: { memberships: { create: { organizationId, role: "STAFF" } }, email: "ai-ctx@example.com", passwordHash: "x", name: "Staff" },
      })
    ).id;
    // ₦3,500 is the kind of low price the model used to misquote as ₦35,000.
    const headwrap = await prisma.product.create({ data: { organizationId, sku: "CTX-HEAD", name: "Ankara Headwrap", priceCents: 350000, moq: 1 } });
    const gown = await prisma.product.create({ data: { organizationId, sku: "CTX-GOWN", name: "Lace Gown", priceCents: 4250000, moq: 1 } });
    headwrapId = headwrap.id;
    gownId = gown.id;
    for (const id of [headwrapId, gownId]) {
      await recordStockMovement({ organizationId, productId: id, quantityDelta: 100, reason: StockMovementReason.INITIAL_STOCK });
    }
  });

  beforeEach(() => {
    mockCreate.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterAll(async () => {
    delete process.env.APP_URL;
    await prisma.$disconnect();
  });

  /** A customer with a chat that has one inbound message, ready for runAIAssist. */
  async function chat(name: string, body = "hello") {
    n += 1;
    const phone = `+1888${String(1000000 + n)}`;
    const customer = await prisma.customer.create({ data: { organizationId, phone, phoneKey: phoneKeyOf(phone)!, name } });
    const conversation = await prisma.conversation.create({ data: { organizationId, customerId: customer.id } });
    await prisma.message.create({ data: { conversationId: conversation.id, direction: "INBOUND", sender: "CUSTOMER", body } });
    return { customerId: customer.id, conversationId: conversation.id };
  }
  const run = (c: { customerId: string; conversationId: string }) =>
    runAIAssist({ organizationId, conversationId: c.conversationId, customerId: c.customerId, createdById: userId });

  describe("prices", () => {
    it("hands the model ready-made text prices and withholds the raw kobo figures", async () => {
      const c = await chat("Price Asker", "how much is the headwrap");
      mockCreate
        .mockResolvedValueOnce(toolCallMessage([{ id: "s1", name: "search_catalogue", input: { query: "ankara headwrap" } }]))
        .mockResolvedValueOnce(textMessage("It is ₦3,500 each."));
      await run(c);

      const entries = JSON.parse(toolResult("s1")) as Record<string, unknown>[];
      expect(entries[0]).toMatchObject({ sku: "CTX-HEAD", price: "₦3,500" });
      expect(entries[0]).not.toHaveProperty("priceCents");
      expect(JSON.stringify(entries)).not.toContain("350000");
    });

    it("formats tiers as text too and keeps kobo when there are any", () => {
      const view = catalogueEntryForModel({
        productId: "p",
        name: "X",
        sku: "X",
        variant: null,
        priceCents: 125050,
        moq: 1,
        unit: "piece",
        stock: 1,
        priceTiers: [{ minQuantity: 10, priceCents: 100000 }],
      });
      expect(view.price).toBe("₦1,250.50");
      expect(view.priceTiers).toEqual([{ minQuantity: 10, price: "₦1,000" }]);
      expect(formatMoneyExact(350000)).toBe("₦3,500");
      expect(formatMoneyExact(4250000)).toBe("₦42,500");
    });

    it("tells the model to quote prices as given and never do its own arithmetic", async () => {
      const c = await chat("Prompt Reader");
      mockCreate.mockResolvedValueOnce(textMessage("Hi"));
      await run(c);
      const system = String((mockCreate.mock.calls[0][0].messages as ToolMessage[])[0].content);
      expect(system).toMatch(/copy the price text exactly/i);
      expect(system).toMatch(/never do your own arithmetic/i);
    });
  });

  describe("business name and delivery questions", () => {
    it("introduces the AI as the actual business, not a hardcoded one", async () => {
      const c = await chat("Name Checker");
      mockCreate.mockResolvedValueOnce(textMessage("Hi"));
      await run(c);
      const system = String((mockCreate.mock.calls[0][0].messages as ToolMessage[])[0].content);
      expect(system).toContain("Spice & Thread Traders");
      expect(system).not.toContain("Adaeze");
    });

    it("forbids guessing about delivery, returns and payment details", async () => {
      const c = await chat("Delivery Asker");
      mockCreate.mockResolvedValueOnce(textMessage("Hi"));
      await run(c);
      const system = String((mockCreate.mock.calls[0][0].messages as ToolMessage[])[0].content);
      expect(system).toMatch(/no information about delivery/i);
      expect(system).toMatch(/do not say yes or no/i);
    });
  });

  describe("duplicate drafts", () => {
    const draftCall = (id: string, productId: string, quantity: number) => toolCallMessage([{ id, name: "create_draft_order", input: { items: [{ productId, quantity }] } }]);

    it("creates one draft, and a repeat of the same request reuses it", async () => {
      const c = await chat("Repeat Buyer");
      mockCreate.mockResolvedValueOnce(draftCall("d1", gownId, 4)).mockResolvedValueOnce(textMessage("Drafted."));
      const first = await run(c);
      expect(first.draftOrder?.reference).toBeDefined();

      // The customer says "yes please go ahead" and the model tries to draft again.
      mockCreate.mockResolvedValueOnce(draftCall("d2", gownId, 4)).mockResolvedValueOnce(textMessage("It is drafted."));
      const second = await run(c);

      expect(second.draftOrder?.id).toBe(first.draftOrder?.id);
      expect(await prisma.order.count({ where: { conversationId: c.conversationId } })).toBe(1);
      expect(JSON.parse(toolResult("d2"))).toMatchObject({ reference: first.draftOrder?.reference, note: expect.stringMatching(/already exists/i) });
    });

    it("updates the open draft when only the quantity changes, instead of adding a second order", async () => {
      const c = await chat("Changes Mind");
      mockCreate.mockResolvedValueOnce(draftCall("e1", gownId, 4)).mockResolvedValueOnce(textMessage("Drafted."));
      const first = await run(c);

      mockCreate.mockResolvedValueOnce(draftCall("e2", gownId, 6)).mockResolvedValueOnce(textMessage("Updated."));
      const second = await run(c);

      expect(second.draftOrder?.id).toBe(first.draftOrder?.id);
      const orders = await prisma.order.findMany({ where: { conversationId: c.conversationId }, include: { items: true } });
      expect(orders).toHaveLength(1);
      expect(orders[0].items[0].quantity).toBe(6);
      expect(orders[0].totalCents).toBe(6 * 4250000);
      expect(JSON.parse(toolResult("e2")).note).toMatch(/updated/i);
    });

    it("refuses to draft more than is in stock, whatever the model asks for", async () => {
      const c = await chat("Greedy Buyer");
      mockCreate.mockResolvedValueOnce(draftCall("h1", gownId, 500)).mockResolvedValueOnce(textMessage("Only 100 are available."));
      const result = await run(c);
      expect(result.draftOrder).toBeUndefined();
      expect(await prisma.order.count({ where: { conversationId: c.conversationId } })).toBe(0);
      expect(toolResult("h1")).toMatch(/only 100 of Lace Gown.*500 requested/i);
    });

    it("still creates a separate draft for different products", async () => {
      const c = await chat("Second Item");
      mockCreate.mockResolvedValueOnce(draftCall("f1", gownId, 2)).mockResolvedValueOnce(textMessage("Drafted."));
      await run(c);
      mockCreate.mockResolvedValueOnce(draftCall("f2", headwrapId, 5)).mockResolvedValueOnce(textMessage("Drafted too."));
      await run(c);
      expect(await prisma.order.count({ where: { conversationId: c.conversationId } })).toBe(2);
    });

    it("shows the model the open drafts at the start of the next turn", async () => {
      const c = await chat("Context Check");
      mockCreate.mockResolvedValueOnce(draftCall("g1", gownId, 3)).mockResolvedValueOnce(textMessage("Drafted."));
      const first = await run(c);

      mockCreate.mockResolvedValueOnce(textMessage("It is drafted."));
      await run(c);
      const lastRequest = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
      const transcript = JSON.stringify((lastRequest.messages as ToolMessage[])[1].content);
      expect(transcript).toContain("Open draft orders already created in this chat");
      expect(transcript).toContain(first.draftOrder!.reference);
      expect(transcript).toContain("3 × Lace Gown");
    });

    it("compares item sets regardless of order or how lines are split", () => {
      const a = mergeItems([{ productId: "p1", quantity: 2 }, { productId: "p1", quantity: 3 }, { productId: "p2", quantity: 1 }]);
      const b = mergeItems([{ productId: "p2", quantity: 1 }, { productId: "p1", quantity: 5 }]);
      expect(sameItems(a, b)).toBe(true);
      expect(sameItems(a, mergeItems([{ productId: "p1", quantity: 4 }, { productId: "p2", quantity: 1 }]))).toBe(false);
      expect(sameProducts(a, mergeItems([{ productId: "p2", quantity: 9 }, { productId: "p1", quantity: 9 }]))).toBe(true);
      expect(sameProducts(a, mergeItems([{ productId: "p1", quantity: 5 }]))).toBe(false);
    });
  });

  describe("order status questions", () => {
    async function shippedOrder(customerId: string, conversationId: string) {
      const draft = await createDraftOrder({ organizationId, customerId, conversationId, createdById: userId, items: [{ productId: headwrapId, quantity: 5 }] });
      const ids = { organizationId, orderId: draft.id, actorId: userId };
      await confirmOrder({ ...ids, allowDuplicate: true });
      await markOrderPaid(ids);
      await shipOrderItems({ ...ids, carrier: "GIG Logistics", trackingReference: "GIG42" });
      return draft;
    }

    it("lets the model look up the customer's own orders, with status, carrier, tracking and link", async () => {
      process.env.APP_URL = "https://shop.example.com";
      const c = await chat("Where Is It", "where is my order?");
      const order = await shippedOrder(c.customerId, c.conversationId);
      mockCreate
        .mockResolvedValueOnce(toolCallMessage([{ id: "o1", name: "get_my_orders", input: {} }]))
        .mockResolvedValueOnce(textMessage("It has shipped."));
      await run(c);
      delete process.env.APP_URL;

      const orders = JSON.parse(toolResult("o1")) as { reference: string; status: string; shipments: { carrier: string; trackingNumber: string }[]; statusPage?: string; items: string[] }[];
      expect(orders).toHaveLength(1);
      expect(orders[0]).toMatchObject({ reference: order.reference, status: "shipped" });
      expect(orders[0].shipments[0]).toMatchObject({ carrier: "GIG Logistics", trackingNumber: "GIG42" });
      expect(orders[0].items).toEqual(["5 × Ankara Headwrap"]);
      expect(orders[0].statusPage).toMatch(new RegExp(`^https://shop.example.com/track/${organizationId}/`));
    });

    it("never shows one customer another customer's orders, whatever the model asks for", async () => {
      const owner = await chat("Real Owner");
      const ownerOrder = await shippedOrder(owner.customerId, owner.conversationId);
      const stranger = await chat("A Stranger", `what is the status of ${ownerOrder.reference}?`);

      // A manipulated model passes someone else's ids as input; they must be ignored.
      mockCreate
        .mockResolvedValueOnce(toolCallMessage([{ id: "x1", name: "get_my_orders", input: { customerId: owner.customerId, reference: ownerOrder.reference } }]))
        .mockResolvedValueOnce(textMessage("I cannot find that order."));
      await run(stranger);

      const result = toolResult("x1");
      expect(result).toMatch(/no orders on record/i);
      expect(result).not.toContain(ownerOrder.reference);
      expect(result).not.toContain("GIG42");
    });

    it("leaves the status link out when APP_URL is not set", async () => {
      delete process.env.APP_URL;
      const c = await chat("No Link");
      await shippedOrder(c.customerId, c.conversationId);
      mockCreate.mockResolvedValueOnce(toolCallMessage([{ id: "n1", name: "get_my_orders", input: {} }])).mockResolvedValueOnce(textMessage("Shipped."));
      await run(c);
      expect(JSON.parse(toolResult("n1"))[0]).not.toHaveProperty("statusPage");
    });
  });
});
