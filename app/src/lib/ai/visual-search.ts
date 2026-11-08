import { tenantDb } from "@/lib/db";
import { embedImage, cosineSimilarity, isVisualSearchConfigured } from "./voyage";

export type VisualMatch = {
  productId: string;
  sku: string;
  name: string;
  variant: string | null;
  similarity: number;
  mimeType: string;
  base64: string;
};

/**
 * Real image-to-image visual search: embeds the customer's photo and ranks it by cosine
 * similarity against every catalogue photo's own stored embedding — not a text/keyword guess.
 * Products whose photo was uploaded before VOYAGE_API_KEY was configured (or while it's unset)
 * simply have no embedding and are skipped, not treated as a non-match.
 */
export async function findVisuallySimilarProducts(
  organizationId: string,
  customerPhoto: { mimeType: string; base64: string },
  limit = 3
): Promise<VisualMatch[]> {
  if (!isVisualSearchConfigured()) return [];

  const db = tenantDb(organizationId);
  const images = await db.productImage.findMany({
    where: { product: { active: true } },
    include: { product: true },
  });
  const withEmbedding = images.filter((img) => img.embedding.length > 0);
  if (withEmbedding.length === 0) return [];

  const queryVector = await embedImage(customerPhoto.mimeType, customerPhoto.base64, "query");

  return withEmbedding
    .map((img) => {
      const variant = img.product.variantAttributes as Record<string, string> | null;
      return {
        productId: img.productId,
        sku: img.product.sku,
        name: img.product.name,
        variant: variant ? Object.values(variant).join(" / ") : null,
        similarity: cosineSimilarity(queryVector, img.embedding),
        mimeType: img.mimeType,
        base64: Buffer.from(img.data).toString("base64"),
      };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
