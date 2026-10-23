import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createDraftOrder, OrderStateError } from "@/lib/orders";
import { searchCatalogue } from "./catalogue-search";

export function isAIConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const MODEL = "claude-opus-5-5";
const MAX_TOOL_ROUNDS = 4;

const searchCatalogueInput = z.object({ query: z.string().min(1) });
const createDraftOrderInput = z.object({
  items: z
    .array(z.object({ productId: z.string().min(1), quantity: z.number().int().positive() }))
    .min(1),
});

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_catalogue",
    description:
      "Search the product catalogue by name, SKU, or variant (colour/size). Returns matching products with their id, name, variant, price, and current stock. Always use this before quoting a price or confirming stock — never guess.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search, e.g. 'black ankara two-piece medium'" },
      },
      required: ["query"],
    },
  },
  {
    name: "create_draft_order",
    description:
      "Creates a DRAFT order for the customer from confirmed product matches, using exact productId values returned by search_catalogue. This never confirms, pays, or commits the order — a human or the customer must still confirm it. Only call this once you are confident about the exact products and quantities.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              productId: { type: "string" },
              quantity: { type: "integer", minimum: 1 },
            },
            required: ["productId", "quantity"],
          },
        },
      },
      required: ["items"],
    },
  },
];

const SYSTEM_PROMPT = `You are the order-assistant for Adaeze Fashion Wholesale, a wholesale fashion/footwear distributor, replying to a customer over WhatsApp.

Rules:
- Never invent products, variants, prices, or stock levels. Always call search_catalogue before stating a price or availability.
- Each search_catalogue result includes priceTiers (quantity-break wholesale pricing) and moq (minimum order quantity). When quoting a price, use the highest-minQuantity tier the requested quantity qualifies for — not always the base priceCents. If the requested quantity is below moq, say so and state the actual minimum.
- If the customer's request is ambiguous (multiple matching variants, unclear quantity, or no confident match), ask a short, specific clarifying question instead of guessing.
- Once you have confident matches with exact products and quantities (meeting each product's moq), call create_draft_order to draft the order using the exact productId values search_catalogue returned — it prices and validates the order itself, so you don't need to compute the total. This never confirms or charges anything — say clearly that a staff member will confirm before it's finalized.
- If requested stock is short, say exactly how many are available (from search_catalogue) and offer to draft the order for the available quantity, or suggest a close alternative you found via search_catalogue — never an invented one.
- Keep replies short, natural, and specific — like a knowledgeable staff member texting back, not a formal chatbot. No markdown formatting.
- Never claim an order is confirmed, paid, or shipped — those states only ever change when a human marks them so.`;

export type AIAssistResult = {
  replyText: string;
  draftOrder?: { id: string; reference: string; totalCents: number };
  toolCalls: { name: string; input: unknown }[];
};

export async function runAIAssist(params: {
  organizationId: string;
  conversationId: string;
  customerId: string;
  createdById: string;
}): Promise<AIAssistResult> {
  if (!isAIConfigured()) {
    throw new Error("AI assist isn't configured (missing ANTHROPIC_API_KEY).");
  }

  const conversation = await prisma.conversation.findFirstOrThrow({
    where: { id: params.conversationId, organizationId: params.organizationId },
    include: { messages: { orderBy: { createdAt: "desc" }, take: 10 }, customer: true },
  });

  const recentMessages = [...conversation.messages].reverse();
  const transcript = recentMessages
    .map((m) => `[${m.direction === "INBOUND" ? "Customer" : m.sender}] ${m.body}`)
    .join("\n");

  const client = new Anthropic();
  const toolCallLog: { name: string; input: unknown }[] = [];
  let draftOrder: AIAssistResult["draftOrder"];

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Conversation so far with ${conversation.customer.name ?? conversation.customer.phone}:\n${transcript}\n\nRespond to the customer's latest message.`,
    },
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      tools: TOOLS,
      messages,
    });

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (toolUseBlocks.length === 0) {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return {
        replyText: text || "Let me check and get back to you.",
        draftOrder,
        toolCalls: toolCallLog,
      };
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUseBlocks) {
      toolCallLog.push({ name: toolUse.name, input: toolUse.input });

      if (toolUse.name === "search_catalogue") {
        const parsed = searchCatalogueInput.safeParse(toolUse.input);
        if (!parsed.success) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            is_error: true,
            content: "Invalid input.",
          });
          continue;
        }
        const matches = await searchCatalogue(params.organizationId, parsed.data.query);
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(matches),
        });
      } else if (toolUse.name === "create_draft_order") {
        const parsed = createDraftOrderInput.safeParse(toolUse.input);
        if (!parsed.success) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            is_error: true,
            content: "Invalid input.",
          });
          continue;
        }
        try {
          const order = await createDraftOrder({
            organizationId: params.organizationId,
            customerId: params.customerId,
            conversationId: params.conversationId,
            createdById: params.createdById,
            items: parsed.data.items,
          });
          draftOrder = { id: order.id, reference: order.reference, totalCents: order.totalCents };
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify({ reference: order.reference, totalCents: order.totalCents }),
          });
        } catch (err) {
          const message = err instanceof OrderStateError ? err.message : "Could not create the draft order.";
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            is_error: true,
            content: message,
          });
        }
      } else {
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          is_error: true,
          content: "Unknown tool.",
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  return {
    replyText: "Let me check on this and get back to you shortly.",
    draftOrder,
    toolCalls: toolCallLog,
  };
}
