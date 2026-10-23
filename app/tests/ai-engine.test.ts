import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: vi.fn().mockImplementation(function MockAnthropic(this: { messages: { create: typeof mockCreate } }) {
      this.messages = { create: mockCreate };
    }),
  };
});

import { phoneKeyOf } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { StockMovementReason } from "@prisma/client";
import { recordStockMovement } from "@/lib/stock";
import { runAIAssist } from "@/lib/ai/engine";

describe("runAIAssist", () => {
  let organizationId: string;
  let userId: string;
  let customerId: string;
  let conversationId: string;
  let productId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "AI Engine Test Org" } });
    organizationId = org.id;

    const user = await prisma.user.create({
      data: { organizationId, email: "ai-engine-test@example.com", passwordHash: "x", name: "Test Staff" },
    });
    userId = user.id;

    const customer = await prisma.customer.create({
      data: { organizationId, phone: "+19990001111", phoneKey: phoneKeyOf("+19990001111")!, name: "AI Test Customer" },
    });
    customerId = customer.id;

    const product = await prisma.product.create({
      data: {
        organizationId,
        sku: "AI-TEST-ANK-BLK-M",
        name: "Ankara Two-Piece Set",
        variantAttributes: { colour: "Black", size: "M" },
        priceCents: 1850000,
      },
    });
    productId = product.id;
    await recordStockMovement({
      organizationId,
      productId,
      quantityDelta: 10,
      reason: StockMovementReason.INITIAL_STOCK,
    });

    const conversation = await prisma.conversation.create({
      data: { organizationId, customerId, channel: "WHATSAPP", status: "NEW" },
    });
    conversationId = conversation.id;
    await prisma.message.create({
      data: {
        conversationId,
        direction: "INBOUND",
        sender: "CUSTOMER",
        body: "20 black ankara two-piece sets, medium, how much?",
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    mockCreate.mockReset();
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  it("searches the catalogue, drafts an order, and returns the final reply — never auto-confirming it", async () => {
    mockCreate
      .mockResolvedValueOnce({
        content: [
          { type: "tool_use", id: "tu1", name: "search_catalogue", input: { query: "black ankara two-piece medium" } },
        ],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "tu2",
            name: "create_draft_order",
            input: { items: [{ productId, quantity: 2 }] },
          },
        ],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: "I've drafted an order for 2 Ankara Two-Piece Sets (Black, M) at ₦18,500 each — a staff member will confirm before it's finalized.",
          },
        ],
      });

    const result = await runAIAssist({ organizationId, conversationId, customerId, createdById: userId });

    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(result.toolCalls.map((t) => t.name)).toEqual(["search_catalogue", "create_draft_order"]);
    expect(result.replyText).toContain("staff member will confirm");
    expect(result.draftOrder).toBeDefined();
    expect(result.draftOrder!.totalCents).toBe(2 * 1850000);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: result.draftOrder!.id },
      include: { items: true },
    });
    expect(order.status).toBe("DRAFT"); // never auto-confirmed
    expect(order.conversationId).toBe(conversationId);
    expect(order.items).toHaveLength(1);
    expect(order.items[0].quantity).toBe(2);
    expect(order.items[0].unitPriceCents).toBe(1850000);
  });

  it("asks a clarifying question without drafting an order when ambiguous", async () => {
    mockCreate
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "tu1", name: "search_catalogue", input: { query: "heels" } }],
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: "We have a couple of heel styles — could you tell me which colour and size you're after?",
          },
        ],
      });

    const result = await runAIAssist({ organizationId, conversationId, customerId, createdById: userId });

    expect(result.draftOrder).toBeUndefined();
    expect(result.replyText).toContain("colour and size");
  });

  it("stops after the round cap instead of looping forever on repeated tool calls", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "tool_use", id: "tu-loop", name: "search_catalogue", input: { query: "anything" } }],
    });

    const result = await runAIAssist({ organizationId, conversationId, customerId, createdById: userId });

    expect(mockCreate).toHaveBeenCalledTimes(4); // MAX_TOOL_ROUNDS
    expect(result.replyText).toBeTruthy();
  });

  it("throws without calling the API when ANTHROPIC_API_KEY isn't set", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    await expect(
      runAIAssist({ organizationId, conversationId, customerId, createdById: userId })
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
