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
// "never the full catalogue loaded into AI context." Variant attributes live
// in a JSON column that isn't indexed for substring search, so matching
// against them (colour/size) happens in memory on this bounded pool rather
// than in SQL.
const CANDIDATE_POOL_LIMIT = 200;

/**
 * Database-backed catalogue search — the only way the AI (or anything else)
 * is allowed to learn what's in the catalogue; it never answers from memory
 * or invents a match. Pulls a bounded candidate pool from SQL (products
 * matching at least one search term by name/SKU, unioned with the most
 * recent active products so variant-only terms like a colour or size are
 * still reachable), then does precise per-term AND matching across
 * name+SKU+variant text on just that bounded pool — never the full catalogue.
 */
export async function searchCatalogue(
  organizationId: string,
  query: string,
  limit = 6
): Promise<CatalogueMatch[]> {
  const normalizedQuery = query.trim().toLowerCase();
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const db = tenantDb(organizationId);
  const [termMatches, recentPool] = await Promise.all([
    db.product.findMany({
      where: {
        organizationId,
        active: true,
        OR: terms.flatMap((term) => [{ name: ci(term) }, { sku: ci(term) }]),
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

  const scored = [...candidates.values()].map((product) => {
    const variant = product.variantAttributes as Record<string, string> | null;
    const variantText = variant ? Object.values(variant).join(" ").toLowerCase() : "";
    const haystack = `${product.name} ${product.sku} ${variantText}`.toLowerCase();

    const matchesAllTerms = terms.every((term) => haystack.includes(term));
    if (!matchesAllTerms) return { product, variant, score: 0 };

    let score = terms.length; // base score for matching every term
    if (product.sku.toLowerCase() === normalizedQuery) score += 100;

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
