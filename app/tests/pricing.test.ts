import { describe, expect, it } from "vitest";
import { resolveUnitPriceCents } from "@/lib/pricing";

describe("resolveUnitPriceCents", () => {
  const tiers = [
    { minQuantity: 10, priceCents: 17000 },
    { minQuantity: 50, priceCents: 15000 },
    { minQuantity: 1, priceCents: 18500 },
  ];

  it("falls back to the base price with no tiers", () => {
    expect(resolveUnitPriceCents(18500, [], 3)).toBe(18500);
  });

  it("uses the base price below the lowest tier threshold", () => {
    expect(resolveUnitPriceCents(99999, tiers, 1)).toBe(18500); // the minQuantity:1 tier covers this
  });

  it("picks the highest qualifying tier, not just any matching one", () => {
    expect(resolveUnitPriceCents(99999, tiers, 10)).toBe(17000);
    expect(resolveUnitPriceCents(99999, tiers, 49)).toBe(17000);
    expect(resolveUnitPriceCents(99999, tiers, 50)).toBe(15000);
    expect(resolveUnitPriceCents(99999, tiers, 1000)).toBe(15000);
  });

  it("is order-independent — tier array order doesn't affect the result", () => {
    const shuffled = [tiers[2], tiers[0], tiers[1]];
    expect(resolveUnitPriceCents(99999, shuffled, 12)).toBe(17000);
  });
});
