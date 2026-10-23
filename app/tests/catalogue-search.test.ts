import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StockMovementReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordStockMovement } from "@/lib/stock";
import { searchCatalogue } from "@/lib/ai/catalogue-search";

describe("searchCatalogue (AI tool, DB-backed)", () => {
  let organizationId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "Catalogue Search Test Org" } });
    organizationId = org.id;

    const products = [
      { sku: "SRCH-ANK-BLK-M", name: "Ankara Two-Piece Set", variantAttributes: { colour: "Black", size: "M" }, priceCents: 1850000, stock: 14 },
      { sku: "SRCH-ANK-RED-L", name: "Ankara Two-Piece Set", variantAttributes: { colour: "Red", size: "L" }, priceCents: 1850000, stock: 4 },
      { sku: "SRCH-LACE-GLD-L", name: "Lace Evening Gown", variantAttributes: { colour: "Gold", size: "L" }, priceCents: 4250000, stock: 0 },
      { sku: "SRCH-TOTE-TAN", name: "Structured Tote Bag", variantAttributes: { colour: "Tan" }, priceCents: 2950000, stock: 10 },
    ];

    for (const p of products) {
      const product = await prisma.product.create({
        data: {
          organizationId,
          sku: p.sku,
          name: p.name,
          variantAttributes: p.variantAttributes,
          priceCents: p.priceCents,
        },
      });
      if (p.stock > 0) {
        await recordStockMovement({
          organizationId,
          productId: product.id,
          quantityDelta: p.stock,
          reason: StockMovementReason.INITIAL_STOCK,
        });
      }
    }

    // An inactive product must never surface in search results.
    await prisma.product.create({
      data: { organizationId, sku: "SRCH-INACTIVE", name: "Discontinued Ankara Set", priceCents: 100000, active: false },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("matches on name via SQL", async () => {
    const results = await searchCatalogue(organizationId, "ankara");
    expect(results.map((r) => r.sku).sort()).toEqual(["SRCH-ANK-BLK-M", "SRCH-ANK-RED-L"]);
  });

  it("ranks an exact SKU match first", async () => {
    const results = await searchCatalogue(organizationId, "SRCH-LACE-GLD-L");
    expect(results[0].sku).toBe("SRCH-LACE-GLD-L");
    expect(results[0].stock).toBe(0);
  });

  it("matches on variant attributes alone (colour/size), not just name/SKU", async () => {
    const results = await searchCatalogue(organizationId, "black m");
    expect(results[0].sku).toBe("SRCH-ANK-BLK-M");
  });

  it("combines a name term with a variant term", async () => {
    const results = await searchCatalogue(organizationId, "ankara red");
    expect(results[0].sku).toBe("SRCH-ANK-RED-L");
  });

  it("never returns an inactive product", async () => {
    const results = await searchCatalogue(organizationId, "ankara");
    expect(results.some((r) => r.sku === "SRCH-INACTIVE")).toBe(false);
  });

  it("returns an empty array for an empty query without querying the database for garbage", async () => {
    expect(await searchCatalogue(organizationId, "   ")).toHaveLength(0);
  });

  it("returns no matches for a genuinely unrelated query", async () => {
    expect(await searchCatalogue(organizationId, "xyznonexistent")).toHaveLength(0);
  });

  it("includes zero-stock products rather than hiding them", async () => {
    const results = await searchCatalogue(organizationId, "lace gown gold");
    expect(results.find((r) => r.sku === "SRCH-LACE-GLD-L")?.stock).toBe(0);
  });

  it("is scoped to the given organization", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other Org" } });
    const results = await searchCatalogue(otherOrg.id, "ankara");
    expect(results).toHaveLength(0);
  });
});
