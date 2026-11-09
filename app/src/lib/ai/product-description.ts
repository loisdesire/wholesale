import OpenAI from "openai";

// Same model as the rest of the AI engine — see src/lib/ai/engine.ts's MODEL constant for why
// this default was chosen (cheap/fast tier, not the flagship). Kept as its own constant here
// rather than importing engine.ts's, to avoid a dependency from this leaf module back into the
// engine (catalogue/actions.ts calls this directly, not through engine.ts).
const MODEL = process.env.OPENAI_MODEL || "gpt-6-luna";

const PROMPT = `Describe this wholesale fashion/footwear product photo in one dense paragraph for a
product search index. Cover: garment/item type, cut or silhouette (e.g. bootcut, wide-leg, skinny,
straight, oversized, fitted, A-line), colour(s), pattern, material/fabric if visible, and any
distinctive features (e.g. frayed hem, appliqué, embroidery, hardware, straps, heel height,
pockets). Plain prose, no markdown, no preamble — just the description. If the photo is unclear or
doesn't show a product, say so in one short sentence instead of guessing.`;

/**
 * Generates a rich, searchable style description from a product's own photo, once, at upload
 * time — closes the gap between how a customer actually describes something ("bootcut jeans")
 * and what a product's name/SKU happens to literally contain. See
 * src/lib/ai/catalogue-search.ts, which matches against this text too.
 */
export async function describeProductImage(mimeType: string, base64: string): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  const client = new OpenAI();
  const response = await client.chat.completions.create({
    model: MODEL,
    reasoning_effort: "none",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
        ],
      },
    ],
  });

  return response.choices[0]?.message.content?.trim() || null;
}
