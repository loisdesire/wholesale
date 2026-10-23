/**
 * Resolves the unit price for a given quantity against a product's quantity-
 * break price tiers (wholesale bulk pricing), falling back to the product's
 * base price when no tier applies. This is the single source of truth for
 * "what does this line cost" — called server-side everywhere a price is
 * quoted or an order item is created (manual order form, AI draft-order
 * tool), never trusted from the client.
 */
export function resolveUnitPriceCents(
  basePriceCents: number,
  tiers: { minQuantity: number; priceCents: number }[],
  quantity: number
): number {
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
