import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { parseProductsCsv, commitProductsImport, serializeProductsCsv } from "@/lib/csv";
import { getProductStock } from "@/lib/stock";

describe("CSV catalogue import/export", () => {
  let organizationId: string;
  let userId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "CSV Test Org" } });
    organizationId = org.id;
    const user = await prisma.user.create({
      data: { organizationId, email: "csv-test@example.com", passwordHash: "x", name: "CSV Tester" },
    });
    userId = user.id;

    await prisma.product.create({
      data: { organizationId, sku: "CSV-EXISTING", name: "Existing Product", priceCents: 500000 },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("classifies new SKUs as create and existing SKUs as update", async () => {
    const csv = [
      "sku,name,colour,size,price,moq,unit",
      "CSV-NEW-1,Brand New Product,Black,M,120.50,5,piece",
      "CSV-EXISTING,Renamed Existing Product,,,55,1,piece",
    ].join("\n");

    const { rows, fileError } = await parseProductsCsv(organizationId, csv);
    expect(fileError).toBeNull();
    expect(rows).toHaveLength(2);

    const created = rows.find((r) => r.sku === "CSV-NEW-1")!;
    expect(created.action).toBe("create");
    expect(created.priceCents).toBe(12050);
    expect(created.moq).toBe(5);
    expect(created.variantAttributes).toEqual({ colour: "Black", size: "M" });

    const updated = rows.find((r) => r.sku === "CSV-EXISTING")!;
    expect(updated.action).toBe("update");
    expect(updated.name).toBe("Renamed Existing Product");
  });

  it("rejects a row with an invalid price and a duplicate-SKU row, without blocking valid rows", async () => {
    const csv = [
      "sku,name,price",
      "CSV-BAD-PRICE,Bad Price Product,not-a-number",
      "CSV-DUP,Duplicate One,10",
      "CSV-DUP,Duplicate Two,20",
      "CSV-GOOD,Good Product,15",
    ].join("\n");

    const { rows } = await parseProductsCsv(organizationId, csv);
    const bad = rows.find((r) => r.sku === "CSV-BAD-PRICE")!;
    expect(bad.action).toBe("error");

    const dups = rows.filter((r) => r.sku === "CSV-DUP");
    expect(dups.every((r) => r.action === "error")).toBe(true);

    const good = rows.find((r) => r.sku === "CSV-GOOD")!;
    expect(good.action).toBe("create");
    expect(good.errors).toHaveLength(0);
  });

  it("only commits non-error rows, and records opening stock as a ledger movement", async () => {
    const csv = [
      "sku,name,price,opening_stock",
      "CSV-COMMIT-1,Commit Product,99.99,7",
      "CSV-COMMIT-BAD,,abc,",
    ].join("\n");

    const { rows } = await parseProductsCsv(organizationId, csv);
    const result = await commitProductsImport({ organizationId, actorId: userId, rows });

    expect(result.created).toBe(1);

    const product = await prisma.product.findFirstOrThrow({
      where: { organizationId, sku: "CSV-COMMIT-1" },
    });
    expect(product.priceCents).toBe(9999);
    expect(await getProductStock(product.id)).toBe(7);

    const badProduct = await prisma.product.findFirst({ where: { organizationId, sku: "" } });
    expect(badProduct).toBeNull();
  });

  it("never touches stock on an update row, even if the file carries an opening_stock column", async () => {
    const before = await getProductStock(
      (await prisma.product.findFirstOrThrow({ where: { organizationId, sku: "CSV-EXISTING" } })).id
    );

    const csv = "sku,name,price,opening_stock\nCSV-EXISTING,Existing Product Updated,60,999";
    const { rows } = await parseProductsCsv(organizationId, csv);
    await commitProductsImport({ organizationId, actorId: userId, rows });

    const product = await prisma.product.findFirstOrThrow({ where: { organizationId, sku: "CSV-EXISTING" } });
    expect(product.name).toBe("Existing Product Updated");
    expect(await getProductStock(product.id)).toBe(before); // unchanged
  });

  it("round-trips through export and re-import without data loss", async () => {
    const product = await prisma.product.create({
      data: {
        organizationId,
        sku: "CSV-ROUNDTRIP",
        name: "Round Trip Product",
        variantAttributes: { colour: "Teal", size: "L", material: "Cotton" },
        priceCents: 345600,
        costCents: 200000,
        moq: 3,
        unit: "carton",
        active: true,
      },
    });

    const csv = serializeProductsCsv([
      {
        sku: product.sku,
        name: product.name,
        variantAttributes: product.variantAttributes,
        priceCents: product.priceCents,
        costCents: product.costCents,
        moq: product.moq,
        unit: product.unit,
        active: product.active,
        stock: 0,
      },
    ]);

    const { rows } = await parseProductsCsv(organizationId, csv);
    const row = rows.find((r) => r.sku === "CSV-ROUNDTRIP")!;
    expect(row.action).toBe("update"); // already exists
    expect(row.name).toBe("Round Trip Product");
    expect(row.priceCents).toBe(345600);
    expect(row.costCents).toBe(200000);
    expect(row.moq).toBe(3);
    expect(row.unit).toBe("carton");
    expect(row.variantAttributes).toEqual({ colour: "Teal", size: "L", material: "Cotton" });
  });
});
