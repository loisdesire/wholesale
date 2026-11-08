const VOYAGE_API_URL = "https://api.voyageai.com/v1/multimodalembeddings";
const MODEL = "voyage-multimodal-3.5";

export function isVisualSearchConfigured() {
  return Boolean(process.env.VOYAGE_API_KEY);
}

export class VoyageError extends Error {}

type VoyageContentPart =
  | { type: "text"; text: string }
  | { type: "image_base64"; image_base64: string };

async function embed(content: VoyageContentPart[], inputType: "query" | "document"): Promise<number[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new VoyageError("VOYAGE_API_KEY isn't configured.");

  const res = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ inputs: [{ content }], model: MODEL, input_type: inputType }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new VoyageError(`Voyage embeddings request failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const json = (await res.json()) as { data?: { embedding: number[] }[] };
  const vector = json.data?.[0]?.embedding;
  if (!vector) throw new VoyageError("Voyage embeddings response had no vector.");
  return vector;
}

/**
 * Embeds an image for visual similarity search. Use "document" when indexing a catalogue photo
 * at upload time, and "query" when embedding a customer's photo to search against those —
 * Voyage's own guidance for asymmetric retrieval (searching one kind of thing against a stored
 * collection of another).
 */
export async function embedImage(
  mimeType: string,
  base64: string,
  inputType: "query" | "document"
): Promise<number[]> {
  return embed([{ type: "image_base64", image_base64: `data:${mimeType};base64,${base64}` }], inputType);
}

/**
 * Standard cosine similarity between two equal-length embedding vectors, in [-1, 1] (in practice
 * close to [0, 1] for same-model image embeddings) — 1 means visually identical.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
