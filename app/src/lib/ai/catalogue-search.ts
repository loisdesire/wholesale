import { tenantDb } from "@/lib/db";
import { getStockBreakdownByProduct } from "@/lib/stock";
import { ci } from "@/lib/search";

export type CatalogueMatch = {
  productId: string;
  name: string;
  sku: string;
  variant: string | null;
  priceCents: number;
  moq: number;
  unit: string;
  priceTiers: { minQuantity: number; priceCents: number }[];
  stock: number;
};

// Bounded candidate pool size — not the whole catalogue, per VISION.md's
// "never the full catalogue loaded into AI context."
const CANDIDATE_POOL_LIMIT = 200;

const STOPWORDS = new Set([
  "a", "an", "the", "in", "on", "with", "for", "of", "and", "or", "to", "is", "at", "by", "from",
  "piece", "set", "women", "womens", "ladies", "men", "mens", "please", "this", "that", "these", "those"
]);

/**
 * Database-backed catalogue search — the only way the AI (or anything else)
 * is allowed to learn what's in the catalogue; it never answers from memory
 * or invents a match. Pulls a bounded candidate pool from SQL, then performs
 * term-overlap and visual keyword matching across name + SKU + variant text.
 */
export async function searchCatalogue(
  organizationId: string,
  query: string,
  limit = 6
): Promise<CatalogueMatch[]> {
  const normalizedQuery = query.trim().toLowerCase();
  const allTerms = normalizedQuery.split(/[\s,+/_-]+/).filter(Boolean);
  if (allTerms.length === 0) return [];

  // Filter conversational stopwords so e.g. "tan tote bag with handles" or "shoes for women"
  // doesn't fail on "with" or "for".
  const meaningful = allTerms.filter((t) => !STOPWORDS.has(t) && t.length > 1);
  const terms = meaningful.length > 0 ? meaningful : allTerms;

  // Same singular/plural tolerance as the scoring step below, applied to the SQL candidate
  // pool too — this is the only thing standing in if the catalogue outgrows CANDIDATE_POOL_LIMIT
  // and the "every active product" fallback pool no longer covers everything.
  const termVariants = (term: string): string[] => {
    if (term.endsWith("s") && term.length > 3) return [term, term.slice(0, -1)];
    return [term, `${term}s`];
  };

  const db = tenantDb(organizationId);
  const [termMatches, recentPool] = await Promise.all([
    db.product.findMany({
      where: {
        organizationId,
        active: true,
        OR: terms.flatMap(termVariants).flatMap((term) => [{ name: ci(term) }, { sku: ci(term) }]),
      },
      include: { priceTiers: true },
      take: CANDIDATE_POOL_LIMIT,
    }),
    db.product.findMany({
      where: { organizationId, active: true },
      include: { priceTiers: true },
      orderBy: { name: "asc" },
      take: CANDIDATE_POOL_LIMIT,
    }),
  ]);

  const candidates = new Map([...termMatches, ...recentPool].map((p) => [p.id, p]));
  if (candidates.size === 0) return [];

  // Available stock only: reserved and damaged units can't be promised to a customer.
  const stockMap = await getStockBreakdownByProduct(organizationId, { productIds: [...candidates.keys()] }, db);

  // Plain substring matching misses basic singular/plural differences between how a customer
  // phrases things ("jeans") and how a product is named ("Star jean") — checking both forms
  // against each other catches that without a full stemming library.
  function matchesTerm(haystack: string, term: string): boolean {
    if (haystack.includes(term)) return true;
    if (term.endsWith("s") && term.length > 3 && haystack.includes(term.slice(0, -1))) return true;
    if (!term.endsWith("s") && haystack.includes(`${term}s`)) return true;
    return false;
  }

  const scored = [...candidates.values()].map((product) => {
    const variant = product.variantAttributes as Record<string, string> | null;
    const variantText = variant ? Object.values(variant).join(" ").toLowerCase() : "";
    const nameLower = product.name.toLowerCase();
    const skuLower = product.sku.toLowerCase();

    let matchedTermsCount = 0;
    let score = 0;

    for (const term of terms) {
      let matched = false;
      if (matchesTerm(skuLower, term)) {
        score += 30;
        matched = true;
      }
      if (matchesTerm(nameLower, term)) {
        score += 18;
        matched = true;
      }
      if (matchesTerm(variantText, term)) {
        score += 10;
        matched = true;
      }
      if (matched) matchedTermsCount++;
    }

    // Require at least one meaningful term match, and if several terms were given, at least half
    // or an exact SKU match to avoid irrelevant noise.
    if (matchedTermsCount === 0) return { product, variant, score: 0 };
    if (terms.length >= 3 && matchedTermsCount < Math.ceil(terms.length / 2)) {
      return { product, variant, score: 0 };
    }

    if (matchedTermsCount === terms.length) score += 35; // bonus for full term overlap
    if (skuLower === normalizedQuery) score += 100;
    if (nameLower === normalizedQuery) score += 50;

    return { product, variant, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ product, variant }) => ({
      productId: product.id,
      name: product.name,
      sku: product.sku,
      variant: variant ? Object.values(variant).join(" / ") : null,
      priceCents: product.priceCents,
      moq: product.moq,
      unit: product.unit,
      priceTiers: product.priceTiers
        .map((t) => ({ minQuantity: t.minQuantity, priceCents: t.priceCents }))
        .sort((a, b) => a.minQuantity - b.minQuantity),
      stock: stockMap.get(product.id)?.available ?? 0,
    }));
}

/**
 * Looks up current price/MOQ/stock for a known set of product ids directly — skips the
 * text-scoring search entirely. Used right after visual search already identified exact
 * candidates, so the model can get pricing in the same round instead of a separate
 * search_catalogue tool round-trip (each one costs a full extra OpenAI request).
 */
export async function getCatalogueEntriesByIds(
  organizationId: string,
  productIds: string[]
): Promise<CatalogueMatch[]> {
  if (productIds.length === 0) return [];
  const db = tenantDb(organizationId);
  const products = await db.product.findMany({
    where: { id: { in: productIds }, active: true },
    include: { priceTiers: true },
  });
  const stockMap = await getStockBreakdownByProduct(organizationId, { productIds }, db);

  return products.map((product) => {
    const variant = product.variantAttributes as Record<string, string> | null;
    return {
      productId: product.id,
      name: product.name,
      sku: product.sku,
      variant: variant ? Object.values(variant).join(" / ") : null,
      priceCents: product.priceCents,
      moq: product.moq,
      unit: product.unit,
      priceTiers: product.priceTiers
        .map((t) => ({ minQuantity: t.minQuantity, priceCents: t.priceCents }))
        .sort((a, b) => a.minQuantity - b.minQuantity),
      stock: stockMap.get(product.id)?.available ?? 0,
    };
  });
}

/**
 * Fetches each product's first catalogue photo (if any), for genuine image-to-image
 * comparison against a customer's photo — search_catalogue's own results are text-only
 * (name/SKU/variant), which is only ever a keyword guess, never a real visual match.
 */
export async function getCandidateImages(
  organizationId: string,
  productIds: string[]
): Promise<Map<string, { mimeType: string; base64: string }>> {
  if (productIds.length === 0) return new Map();
  const db = tenantDb(organizationId);
  const images = await db.productImage.findMany({
    where: { productId: { in: productIds } },
    orderBy: { position: "asc" },
  });
  const result = new Map<string, { mimeType: string; base64: string }>();
  for (const img of images) {
    if (result.has(img.productId)) continue; // first image per product only
    result.set(img.productId, { mimeType: img.mimeType, base64: Buffer.from(img.data).toString("base64") });
  }
  return result;
}
