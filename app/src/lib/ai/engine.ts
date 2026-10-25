import OpenAI from "openai";
import { z } from "zod";
import { tenantDb } from "@/lib/db";
import { createDraftOrder, OrderStateError } from "@/lib/orders";
import { searchCatalogue } from "./catalogue-search";

export function isAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

// Configurable, not hardcoded: OpenAI's exact current flagship model id couldn't be confirmed
// with full confidence at the time this was written (conflicting naming across sources — see
// docs/PROGRESS.md). Set OPENAI_MODEL to override without a code change if this id is wrong or
// retired by the time this runs for real.
const MODEL = process.env.OPENAI_MODEL || "gpt-6-astra";
const MAX_TOOL_ROUNDS = 4;

const searchCatalogueInput = z.object({ query: z.string().min(1) });
const createDraftOrderInput = z.object({
  items: z
    .array(z.object({ productId: z.string().min(1), quantity: z.number().int().positive() }))
    .min(1),
});

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_catalogue",
      description:
        "Search the product catalogue by name, SKU, or variant (colour/size). Returns matching products with their id, name, variant, price, and current stock. Always use this before quoting a price or confirming stock — never guess.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free-text search, e.g. 'black ankara two-piece medium'" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_draft_order",
      description:
        "Creates a DRAFT order for the customer from confirmed product matches, using exact productId values returned by search_catalogue. This never confirms, pays, or commits the order — a human or the customer must still confirm it. Only call this once you are confident about the exact products and quantities.",
      parameters: {
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
  },
];

const SYSTEM_PROMPT = `You are the order-assistant for Adaeze Fashion Wholesale, a wholesale fashion/footwear distributor, replying to a customer over WhatsApp.

Rules:
- Never invent products, variants, prices, or stock levels. Always call search_catalogue before stating a price or availability.
- Each search_catalogue result includes priceTiers (quantity-break wholesale pricing) and moq (minimum order quantity). When quoting a price, use the highest-minQuantity tier the requested quantity qualifies for — not always the base priceCents. If the requested quantity is below moq, say so and state the actual minimum.
- If the customer's request is ambiguous (multiple matching variants, unclear quantity, or no confident match), ask a short, specific clarifying question instead of guessing.
- A customer may send a photo instead of, or alongside, a text description — sometimes a screenshot from a video, which can be blurry, oddly framed, or poorly lit. Treat an image the same way as an ambiguous text message: if you're not genuinely confident which catalogue item it shows (pattern, colour, or style could plausibly match more than one product, or none), say so and ask — naming what you can tell and what you're unsure of — rather than guessing a specific match from a photo you can't read with confidence. Never claim a specific product match from an image you're not actually sure about.
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
    throw new Error("AI assist isn't configured (missing OPENAI_API_KEY).");
  }

  const conversation = await tenantDb(params.organizationId).conversation.findFirstOrThrow({
    where: { id: params.conversationId, organizationId: params.organizationId },
    include: {
      messages: { orderBy: { createdAt: "desc" }, take: 10, include: { attachments: true } },
      customer: true,
    },
  });

  const recentMessages = [...conversation.messages].reverse();

  const client = new OpenAI();
  const toolCallLog: { name: string; input: unknown }[] = [];
  let draftOrder: AIAssistResult["draftOrder"];

  // One content block per message, in order — a plain text line for each, plus an inline image
  // for any attachment an inbound one carries. Kept as a single user turn (not a full
  // role-per-message transcript) to match this engine's existing "one shot, then a tool loop"
  // shape; the model reads the whole labelled transcript at once.
  const transcriptContent: OpenAI.Chat.ChatCompletionContentPart[] = [];
  for (const m of recentMessages) {
    const label = m.direction === "INBOUND" ? "Customer" : m.sender;
    transcriptContent.push({ type: "text", text: `[${label}] ${m.body}` });
    for (const a of m.attachments) {
      const base64 = Buffer.from(a.data).toString("base64");
      transcriptContent.push({ type: "image_url", image_url: { url: `data:${a.mimeType};base64,${base64}` } });
    }
  }
  transcriptContent.push({
    type: "text",
    text: `(Conversation so far with ${conversation.customer.name ?? conversation.customer.phone} — respond to the customer's latest message.)`,
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: transcriptContent },
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: TOOLS,
    });

    const choice = response.choices[0];
    const toolCalls = choice.message.tool_calls ?? [];

    if (toolCalls.length === 0) {
      return {
        replyText: choice.message.content?.trim() || "Let me check and get back to you.",
        draftOrder,
        toolCalls: toolCallLog,
      };
    }

    messages.push(choice.message);

    for (const toolCall of toolCalls) {
      if (toolCall.type !== "function") continue;
      const { name, arguments: rawArgs } = toolCall.function;
      let input: unknown;
      try {
        input = JSON.parse(rawArgs);
      } catch {
        messages.push({ role: "tool", tool_call_id: toolCall.id, content: "Invalid input." });
        continue;
      }
      toolCallLog.push({ name, input });

      if (name === "search_catalogue") {
        const parsed = searchCatalogueInput.safeParse(input);
        if (!parsed.success) {
          messages.push({ role: "tool", tool_call_id: toolCall.id, content: "Invalid input." });
          continue;
        }
        const matches = await searchCatalogue(params.organizationId, parsed.data.query);
        messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(matches) });
      } else if (name === "create_draft_order") {
        const parsed = createDraftOrderInput.safeParse(input);
        if (!parsed.success) {
          messages.push({ role: "tool", tool_call_id: toolCall.id, content: "Invalid input." });
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
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({ reference: order.reference, totalCents: order.totalCents }),
          });
        } catch (err) {
          const message = err instanceof OrderStateError ? err.message : "Could not create the draft order.";
          messages.push({ role: "tool", tool_call_id: toolCall.id, content: message });
        }
      } else {
        messages.push({ role: "tool", tool_call_id: toolCall.id, content: "Unknown tool." });
      }
    }
  }

  return {
    replyText: "Let me check on this and get back to you shortly.",
    draftOrder,
    toolCalls: toolCallLog,
  };
}
