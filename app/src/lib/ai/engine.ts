import OpenAI from "openai";
import { z } from "zod";
import { tenantDb } from "@/lib/db";
import { createDraftOrder, OrderStateError } from "@/lib/orders";
import { searchCatalogue, getCandidateImages, getCatalogueEntriesByIds } from "./catalogue-search";
import { findVisuallySimilarProducts } from "./visual-search";

export function isAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

// Configurable, not hardcoded: OpenAI's exact current model ids couldn't be confirmed with full
// confidence at the time this was written (conflicting naming across sources — see
// docs/PROGRESS.md). Defaults to the cheap/fast tier (Luna), not the flagship (Astra) — picked
// deliberately on cost, not capability: PLAN_LIMITS.aiRepliesPerMonth is a real per-reply cost
// line (see docs/PROGRESS.md's pricing discussion), and this app's task doesn't need flagship
// reasoning depth for most replies. Set OPENAI_MODEL to override without a code change.
const MODEL = process.env.OPENAI_MODEL || "gpt-6-luna";
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

const SYSTEM_PROMPT = `You are the order-assistant for Adaeze Fashion Wholesale, a wholesale fashion/footwear distributor, replying to a customer over WhatsApp or Telegram.

Rules:
- Never invent products, variants, prices, or stock levels. Always call search_catalogue before stating a price or availability.
- Call search_catalogue fresh on every turn where the customer could be asking about products — including a short follow-up like "still nothing?" or "what do you have?" — using the most specific product term mentioned anywhere earlier in the conversation if the latest message doesn't name one. Never rely on what an earlier reply in this conversation (including your own) said was or wasn't available — the catalogue can change between messages, so re-check instead of repeating a past answer.
- If no specific product, category, or keyword has been named anywhere in the visible conversation, you have nothing to search for yet — don't call search_catalogue with a vague phrase (e.g. "clothes", "nothing", "stock") and don't claim the catalogue search came up empty. Just ask what they're looking for.
- Each search_catalogue result includes priceTiers (quantity-break wholesale pricing) and moq (minimum order quantity). When quoting a price, use the highest-minQuantity tier the requested quantity qualifies for — not always the base priceCents. If the requested quantity is below moq, say so and state the actual minimum.
- If the customer's request is ambiguous (multiple matching variants, unclear quantity, or no confident match), ask a short, specific clarifying question instead of guessing.
- A customer may send a photo (e.g. asking "Do you have this?", "How much for this?", or sharing a product photo). When an image arrives:
  1. If real visual search results appear right after the photo in this conversation, that is a genuine image-to-image comparison (cosine similarity between the customer's photo and our own catalogue photos) — not a guess. Treat a high match (roughly 90%+) as the same item; a middling one as a possible match worth confirming with the customer; a low one (or no visual search results at all — e.g. none of our photos have a stored visual embedding yet) as no confident visual match.
  2. When visual search results appear, current price/MOQ/stock for those exact same products is already given right after them — use it directly, don't call search_catalogue again for those specific products (that would just be a slower, redundant lookup of data you already have). Only call search_catalogue if you need something visual search didn't return, or no visual search results appeared at all (e.g. no photo embeddings exist yet) — in that case, call it with your own best keyword guess from the photo, since you still can't quote a price or confirm stock without it.
  3. If visual search found no match (or wasn't available) and search_catalogue's keyword guess returns results but none is a confident match, never say you found nothing or have no matching style — that's false when the tool actually returned items. Tell the customer exactly what those results are (name, price, stock) and say plainly you're not sure it's the exact same style/colour/detailing as their photo, then ask them to confirm.
  4. Only say you don't carry anything like it if you genuinely got zero results (from visual search and/or search_catalogue) for every approach you tried.
- Once you have confident matches with exact products and quantities (meeting each product's moq), call create_draft_order to draft the order using the exact productId values search_catalogue returned — it prices and validates the order itself, so you don't need to compute the total. This never confirms or charges anything — say clearly that a staff member will confirm before it's finalized.
- If requested stock is short, say exactly how many are available (from search_catalogue) and offer to draft the order for the available quantity, or suggest a close alternative you found via search_catalogue — never an invented one.
- Keep replies short, natural, and specific — like a knowledgeable staff member texting back, not a formal chatbot. No markdown formatting.
- Never claim an order is confirmed, paid, or shipped — those states only ever change when a human marks them so.`;

export type AIAssistResult = {
  replyText: string;
  draftOrder?: { id: string; reference: string; totalCents: number };
  toolCalls: { name: string; input: unknown }[];
  // The top real visual-search match for a customer photo, if any — so the reply can carry the
  // actual catalogue photo back, not just a text claim the customer has no way to verify.
  matchedProductImage?: { mimeType: string; base64: string; sku: string; similarity: number };
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
      messages: { orderBy: { createdAt: "desc" }, take: 30, include: { attachments: true } },
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
      if (!a.mimeType.startsWith("image/")) continue;
      const base64 = Buffer.from(a.data).toString("base64");
      transcriptContent.push({ type: "image_url", image_url: { url: `data:${a.mimeType};base64,${base64}` } });
    }
  }

  // Only the triggering message's own photo (the newest message in the window, if it's an inbound
  // image) runs visual search — not any photo anywhere earlier in the conversation. Otherwise a
  // single photo sent once would re-trigger a fresh Voyage call on every later text-only reply.
  const triggeringMessage = recentMessages[recentMessages.length - 1];
  const triggeringImageAttachment =
    triggeringMessage?.direction === "INBOUND"
      ? triggeringMessage.attachments.find((a) => a.mimeType.startsWith("image/"))
      : undefined;
  const latestInboundImage = triggeringImageAttachment
    ? { mimeType: triggeringImageAttachment.mimeType, base64: Buffer.from(triggeringImageAttachment.data).toString("base64") }
    : undefined;

  // Real image-to-image visual search (not a keyword guess) against the customer's most recent
  // photo — ranked by actual cosine similarity between stored catalogue-photo embeddings and this
  // photo's own embedding. See src/lib/ai/visual-search.ts.
  let visualMatchInjected = false;
  let topVisualMatch: AIAssistResult["matchedProductImage"];
  if (latestInboundImage) {
    const visualMatches = await findVisuallySimilarProducts(params.organizationId, latestInboundImage, 3);
    if (visualMatches.length > 0) {
      visualMatchInjected = true;
      topVisualMatch = {
        mimeType: visualMatches[0].mimeType,
        base64: visualMatches[0].base64,
        sku: visualMatches[0].sku,
        similarity: visualMatches[0].similarity,
      };
      transcriptContent.push({
        type: "text",
        text: "Real visual search results — our own catalogue photos ranked by actual image similarity to the customer's photo above (most similar first, as a percentage). This is a genuine visual comparison, not a guess — trust it over your own impression of whether the item looks familiar:",
      });
      for (const match of visualMatches) {
        transcriptContent.push({
          type: "text",
          text: `${Math.round(match.similarity * 100)}% visual similarity — ${match.sku} (${match.name}${match.variant ? `, ${match.variant}` : ""}):`,
        });
        transcriptContent.push({
          type: "image_url",
          image_url: { url: `data:${match.mimeType};base64,${match.base64}` },
        });
      }

      // Current price/MOQ/stock for exactly these matched products, in the same round — skips
      // a separate search_catalogue tool round-trip (a full extra OpenAI request) for the common
      // "customer sends a photo" case, where the model would otherwise always need to call it
      // right after anyway.
      const entries = await getCatalogueEntriesByIds(
        params.organizationId,
        visualMatches.map((m) => m.productId)
      );
      if (entries.length > 0) {
        transcriptContent.push({
          type: "text",
          text: `Current price/MOQ/stock for those same matches (no need to call search_catalogue again for these specific products — only for something else): ${JSON.stringify(entries)}`,
        });
      }
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
      reasoning_effort: "none",
    });

    const choice = response.choices[0];
    const toolCalls = choice.message.tool_calls ?? [];

    if (toolCalls.length === 0) {
      return {
        replyText: choice.message.content?.trim() || "Let me check and get back to you.",
        draftOrder,
        toolCalls: toolCallLog,
        matchedProductImage: topVisualMatch,
      };
    }

    messages.push(choice.message);

    // Collected across this round's tool calls, then appended as one trailing user turn after
    // every tool_call_id has its required "tool"-role response — the Chat Completions API
    // expects those immediately following the assistant message, so a mid-loop "user" message
    // would break that sequencing.
    const pendingCandidateImages: OpenAI.Chat.ChatCompletionContentPart[] = [];

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

        // Skip when real visual search already ran above — re-sending the same catalogue photos
        // here would just double the image payload for no new information.
        if (latestInboundImage && !visualMatchInjected && matches.length > 0) {
          const imageMap = await getCandidateImages(
            params.organizationId,
            matches.slice(0, 3).map((m) => m.productId)
          );
          for (const match of matches.slice(0, 3)) {
            const img = imageMap.get(match.productId);
            if (!img) continue;
            pendingCandidateImages.push({
              type: "text",
              text: `Our actual catalogue photo for ${match.sku} (${match.name}${match.variant ? `, ${match.variant}` : ""}):`,
            });
            pendingCandidateImages.push({
              type: "image_url",
              image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
            });
          }
        }
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

    if (pendingCandidateImages.length > 0) {
      messages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: "(Compare the customer's photo above against these actual catalogue photos before replying — don't rely on the text description alone.)",
          },
          ...pendingCandidateImages,
        ],
      });
    }
  }

  return {
    replyText: "Let me check on this and get back to you shortly.",
    draftOrder,
    toolCalls: toolCallLog,
    matchedProductImage: topVisualMatch,
  };
}
