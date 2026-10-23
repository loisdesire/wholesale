/**
 * Resolves the unit price for a given quantity against a product's quantity-
 * break price tiers (wholesale bulk pricing), falling back to the product's
 * base price when no tier applies. This is the single source of truth for
 * "what does this line cost" (an explicit per-customer agreed price wins over
 * tiers, which win over the list price) — called server-side everywhere a price is
 * quoted or an order item is created (manual order form, AI draft-order
 * tool), never trusted from the client.
 */
export function resolveUnitPriceCents(
  basePriceCents: number,
  tiers: { minQuantity: number; priceCents: number }[],
  quantity: number,
  agreedPriceCents?: number | null
): number {
  // A price agreed with this specific customer beats tiers and the list price.
  if (agreedPriceCents != null) return agreedPriceCents;
  let best: number | null = null;
  let bestMinQuantity = -Infinity;
  for (const tier of tiers) {
    if (quantity >= tier.minQuantity && tier.minQuantity > bestMinQuantity) {
      best = tier.priceCents;
      bestMinQuantity = tier.minQuantity;
    }
  }
  return best ?? basePriceCents;
}
