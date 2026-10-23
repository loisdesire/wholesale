import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StockMovementReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createCustomer } from "@/lib/customers";
import { createDraftOrder } from "@/lib/orders";
import { recordStockMovement } from "@/lib/stock";
import { buildOrderWhere, parseOrderStatus, phoneFragments, searchEverything } from "@/lib/search";

describe("phoneFragments", () => {
  it("turns a typed number in any format into digit fragments to look for", () => {
    expect(phoneFragments("0803 123")).toEqual(["0803123", "803123"]);
    expect(phoneFragments("+234 803")).toEqual(["234803"]);
    expect(phoneFragments("803123")).toEqual(["803123"]);
  });

  it("ignores text and very short digit runs", () => {
    expect(phoneFragments("ankara")).toEqual([]);
    expect(phoneFragments("ORD-1001")).toEqual([]);
    expect(phoneFragments("12")).toEqual([]);
    expect(phoneFragments("")).toEqual([]);
  });
});

describe("parseOrderStatus", () => {
  it("accepts real statuses only", () => {
    expect(parseOrderStatus("PAID")).toBe("PAID");
    expect(parseOrderStatus("paid")).toBeUndefined();
    expect(parseOrderStatus("DROP TABLE")).toBeUndefined();
    expect(parseOrderStatus(undefined)).toBeUndefined();
  });
});

describe("search", () => {
  let organizationId: string;
  let otherOrganizationId: string;
  let userId: string;
  let ankaraId: string;
  let denimId: string;
  const orders: Record<string, { id: string; reference: string }> = {};

  beforeAll(async () => {
    organizationId = (await prisma.organization.create({ data: { name: "Search Org" } })).id;
    otherOrganizationId = (await prisma.organization.create({ data: { name: "Other Search Org" } })).id;
    userId = (
      await prisma.user.create({ data: { memberships: { create: { organizationId, role: "OWNER" } }, email: "search@example.com", passwordHash: "x", name: "S" } })
    ).id;

    ankaraId = (await prisma.product.create({ data: { organizationId, sku: "SRCH-ANK-1", name: "Ankara Wrapper", priceCents: 1000 } })).id;
    denimId = (await prisma.product.create({ data: { organizationId, sku: "SRCH-DNM-1", name: "Denim Jacket", priceCents: 2000 } })).id;
    for (const productId of [ankaraId, denimId]) {
      await recordStockMovement({ organizationId, productId, quantityDelta: 100, reason: StockMovementReason.INITIAL_STOCK });
    }

    const ngozi = await createCustomer({ organizationId, phone: "0803 777 1111", name: "Ngozi Eze", email: "ngozi@shop.ng", notes: "Boutique in Enugu" });
    const funmi = await createCustomer({ organizationId, phone: "+2347098761234", name: "Funmilayo Adebayo" });

    orders.ngoziAnkara = await createDraftOrder({
      organizationId, customerId: ngozi.id, createdById: userId, items: [{ productId: ankaraId, quantity: 2 }], notes: "gift wrap please",
    });
    orders.funmiDenim = await createDraftOrder({
      organizationId, customerId: funmi.id, createdById: userId, items: [{ productId: denimId, quantity: 1 }], deliveryAddress: "14 Allen Avenue, Ikeja",
    });
    await prisma.order.update({ where: { id: orders.funmiDenim.id }, data: { status: "PAID", createdAt: new Date("2026-03-10T12:00:00Z") } });

    // Another organization with look-alike data that must never appear.
    const foreign = await createCustomer({ organizationId: otherOrganizationId, phone: "0803 777 1111", name: "Ngozi Eze" });
    const foreignProduct = await prisma.product.create({ data: { organizationId: otherOrganizationId, sku: "SRCH-ANK-1", name: "Ankara Wrapper", priceCents: 1 } });
    await recordStockMovement({ organizationId: otherOrganizationId, productId: foreignProduct.id, quantityDelta: 5, reason: StockMovementReason.INITIAL_STOCK });
    await createDraftOrder({
      organizationId: otherOrganizationId, customerId: foreign.id, createdById: userId, items: [{ productId: foreignProduct.id, quantity: 1 }],
    }).catch(() => undefined);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const find = (filters: Parameters<typeof buildOrderWhere>[1]) =>
    prisma.order.findMany({ where: buildOrderWhere(organizationId, filters) }).then((rows) => rows.map((r) => r.reference).sort());

  const refs = (...o: { reference: string }[]) => o.map((x) => x.reference).sort();

  describe("order filters", () => {
    it("matches the reference, case-insensitively and by fragment", async () => {
      const ref = orders.ngoziAnkara.reference;
      expect(await find({ q: ref.toLowerCase() })).toEqual(refs(orders.ngoziAnkara));
      expect(await find({ q: ref.slice(4) })).toContain(orders.ngoziAnkara.reference);
    });

    it("matches the customer by name, email or phone in any format", async () => {
      expect(await find({ q: "ngozi" })).toEqual(refs(orders.ngoziAnkara));
      expect(await find({ q: "NGOZI@SHOP" })).toEqual(refs(orders.ngoziAnkara));
      for (const typed of ["0803 777", "803777111", "+234 803 777 1111", "2348037771111"]) {
        expect(await find({ q: typed }), typed).toEqual(refs(orders.ngoziAnkara));
      }
      expect(await find({ q: "0709 876" })).toEqual(refs(orders.funmiDenim));
    });

    it("matches products on the order, notes and delivery address", async () => {
      expect(await find({ q: "denim" })).toEqual(refs(orders.funmiDenim));
      expect(await find({ q: "SRCH-ANK" })).toEqual(refs(orders.ngoziAnkara));
      expect(await find({ q: "gift wrap" })).toEqual(refs(orders.ngoziAnkara));
      expect(await find({ q: "allen avenue" })).toEqual(refs(orders.funmiDenim));
    });

    it("filters by status and by an inclusive date range, and combines filters", async () => {
      expect(await find({ status: "PAID" })).toEqual(refs(orders.funmiDenim));
      expect(await find({ status: "DRAFT" })).toEqual(refs(orders.ngoziAnkara));
      expect(await find({ status: "FULFILLED" })).toEqual([]);
      expect(await find({ from: "2026-03-10", to: "2026-03-10" })).toEqual(refs(orders.funmiDenim));
      expect(await find({ from: "2026-03-11", to: "2026-03-31" })).toEqual([]);
      expect(await find({ to: "2026-03-10" })).toEqual(refs(orders.funmiDenim));
      expect(await find({ status: "PAID", q: "ngozi" })).toEqual([]);
    });

    it("ignores malformed dates instead of failing", async () => {
      expect(await find({ from: "yesterday", to: "2026-13-99" })).toHaveLength(2);
    });

    it("never returns another organization's orders", async () => {
      const all = await prisma.order.findMany({ where: buildOrderWhere(organizationId, { q: "ankara" }) });
      expect(all.every((o) => o.organizationId === organizationId)).toBe(true);
    });

    it("treats SQL-ish and wildcard input as plain text", async () => {
      expect(await find({ q: "%" })).toEqual([]);
      expect(await find({ q: "'; DROP TABLE \"Order\"; --" })).toEqual([]);
      expect(await prisma.order.count({ where: { organizationId } })).toBe(2);
    });
  });

  describe("literal matching of wildcard characters", () => {
    it("finds a product by '50%' literally, and '%' or '_' don't match everything", async () => {
      await prisma.product.create({ data: { organizationId, sku: "SRCH-COT-1", name: "Cotton 50% blend", priceCents: 1 } });
      await prisma.product.create({ data: { organizationId, sku: "SRCH_UNDER", name: "Underscore Item", priceCents: 1 } });

      expect((await searchEverything(organizationId, "50%")).products.map((p) => p.sku)).toEqual(["SRCH-COT-1"]);
      expect((await searchEverything(organizationId, "5_%")).products).toEqual([]);
      expect((await searchEverything(organizationId, "%%")).products).toEqual([]);
      // A literal underscore matches only SKUs that really contain one.
      expect((await searchEverything(organizationId, "SRCH_")).products.map((p) => p.sku)).toEqual(["SRCH_UNDER"]);
    });
  });

  describe("search across everything", () => {
    it("finds orders, customers, products and returns for one query", async () => {
      const r = await searchEverything(organizationId, "ankara");
      expect(r.products.map((p) => p.sku)).toEqual(["SRCH-ANK-1"]);
      expect(r.orders.map((o) => o.reference)).toEqual(refs(orders.ngoziAnkara));
      expect(r.customers).toEqual([]);
    });

    it("finds a customer by a number typed any way", async () => {
      const r = await searchEverything(organizationId, "0803 777 1111");
      expect(r.customers.map((c) => c.name)).toEqual(["Ngozi Eze"]);
      expect(r.orders.map((o) => o.reference)).toEqual(refs(orders.ngoziAnkara));
    });

    it("returns nothing for a query that is too short, and is scoped to the organization", async () => {
      expect(await searchEverything(organizationId, "a")).toEqual({ orders: [], customers: [], products: [], returns: [] });
      const r = await searchEverything(otherOrganizationId, "ngozi");
      expect(r.customers).toHaveLength(1);
      expect(r.customers[0].organizationId).toBe(otherOrganizationId);
      expect(r.orders.every((o) => o.organizationId === otherOrganizationId)).toBe(true);
    });
  });
});
