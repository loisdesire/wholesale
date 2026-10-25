import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { phoneKeyOf } from "@/lib/phone";
import { recordStockMovement } from "@/lib/stock";
import { StockMovementReason } from "@prisma/client";
import { createDraftOrder, confirmOrder } from "@/lib/orders";
import { getPlatformOverview } from "@/lib/platform-admin";

describe("getPlatformOverview", () => {
  let orgAId: string;
  let orgBId: string;

  beforeAll(async () => {
    const orgA = await prisma.organization.create({ data: { name: "Platform Admin Test Org A", plan: "STARTER" } });
    orgAId = orgA.id;
    const orgB = await prisma.organization.create({ data: { name: "Platform Admin Test Org B", plan: "GROWTH" } });
    orgBId = orgB.id;

    const ownerA = await prisma.user.create({
      data: { memberships: { create: { organizationId: orgAId, role: "OWNER" } }, email: "platform-admin-a@example.com", passwordHash: "x", name: "Owner A" },
    });
    await prisma.user.create({
      data: { memberships: { create: { organizationId: orgBId, role: "OWNER" } }, email: "platform-admin-b1@example.com", passwordHash: "x", name: "Owner B1" },
    });
    await prisma.user.create({
      data: { memberships: { create: { organizationId: orgBId, role: "STAFF" } }, email: "platform-admin-b2@example.com", passwordHash: "x", name: "Staff B2" },
    });

    // Org A gets one real order this period; org B gets none — proves usage is computed per
    // organization, not accidentally summed or shared across them.
    const phone = "+15557770040";
    const customerA = await prisma.customer.create({ data: { organizationId: orgAId, phone, phoneKey: phoneKeyOf(phone)!, name: "Platform Admin Test Customer" } });
    const productA = await prisma.product.create({ data: { organizationId: orgAId, sku: "PLATADMIN-TEST-1", name: "Platform Admin Test Product", priceCents: 5000 } });
    await recordStockMovement({ organizationId: orgAId, productId: productA.id, quantityDelta: 10, reason: StockMovementReason.INITIAL_STOCK });
    const order = await createDraftOrder({ organizationId: orgAId, customerId: customerA.id, createdById: ownerA.id, items: [{ productId: productA.id, quantity: 1 }] });
    await confirmOrder({ organizationId: orgAId, orderId: order.id, actorId: ownerA.id, allowDuplicate: true });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lists every organization with its own plan and usage, never cross-contaminated", async () => {
    const overview = await getPlatformOverview();
    const byId = Object.fromEntries(overview.map((o) => [o.id, o]));

    expect(byId[orgAId]).toMatchObject({ name: "Platform Admin Test Org A", plan: "STARTER", staffSeats: 1, ordersThisPeriod: 1 });
    expect(byId[orgBId]).toMatchObject({ name: "Platform Admin Test Org B", plan: "GROWTH", staffSeats: 2, ordersThisPeriod: 0 });
  });

  it("includes every organization created, not a subset", async () => {
    const overview = await getPlatformOverview();
    const ids = overview.map((o) => o.id);
    expect(ids).toContain(orgAId);
    expect(ids).toContain(orgBId);
  });
});
