import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { phoneKeyOf } from "@/lib/phone";
import { recordStockMovement } from "@/lib/stock";
import { StockMovementReason } from "@prisma/client";
import { createDraftOrder, confirmOrder } from "@/lib/orders";
import { extendTrial, getPlatformOverview, markSubscriptionActive, PlatformAdminError } from "@/lib/platform-admin";

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

describe("extendTrial", () => {
  async function trialingOrg(trialEndsAt: Date | null) {
    const org = await prisma.organization.create({
      data: { name: "Extend Trial Test Org", plan: "STARTER", subscriptionStatus: "TRIALING", trialEndsAt },
    });
    const actor = await prisma.user.create({
      data: { memberships: { create: { organizationId: org.id, role: "OWNER" } }, email: `extend-trial-${org.id}@example.com`, passwordHash: "x", name: "Admin" },
    });
    return { orgId: org.id, actorId: actor.id };
  }

  it("pushes trialEndsAt out by the given number of days, measured from the current trialEndsAt when it's still in the future", async () => {
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const { orgId, actorId } = await trialingOrg(future);

    await extendTrial({ organizationId: orgId, days: 7, actorId });

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    const expected = future.getTime() + 7 * 24 * 60 * 60 * 1000;
    expect(org.trialEndsAt!.getTime()).toBeCloseTo(expected, -2);
  });

  it("measures from now, not a stale past date, when the trial has already expired", async () => {
    const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const { orgId, actorId } = await trialingOrg(past);

    const before = Date.now();
    await extendTrial({ organizationId: orgId, days: 7, actorId });

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    // If it had wrongly measured from the stale past date, this would still be in the past.
    expect(org.trialEndsAt!.getTime()).toBeGreaterThan(before);
  });

  it("refuses an organization that isn't trialing", async () => {
    const { orgId, actorId } = await trialingOrg(new Date());
    await prisma.organization.update({ where: { id: orgId }, data: { subscriptionStatus: "ACTIVE" } });

    await expect(extendTrial({ organizationId: orgId, days: 7, actorId })).rejects.toThrow(PlatformAdminError);
  });

  it.each([0, -1, 91, 1.5])("refuses an invalid day count (%s)", async (days) => {
    const { orgId, actorId } = await trialingOrg(new Date());
    await expect(extendTrial({ organizationId: orgId, days, actorId })).rejects.toThrow(PlatformAdminError);
  });

  it("records an audit log entry in the organization's own tenant data", async () => {
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const { orgId, actorId } = await trialingOrg(future);

    await extendTrial({ organizationId: orgId, days: 7, actorId });

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: "TRIAL_EXTENDED" } });
    expect(entry.actorId).toBe(actorId);
    expect(entry.after).toMatchObject({ extendedByDays: 7 });
  });
});

describe("markSubscriptionActive", () => {
  async function pastDueOrg() {
    const org = await prisma.organization.create({ data: { name: "Mark Active Test Org", plan: "GROWTH", subscriptionStatus: "PAST_DUE" } });
    const actor = await prisma.user.create({
      data: { memberships: { create: { organizationId: org.id, role: "OWNER" } }, email: `mark-active-${org.id}@example.com`, passwordHash: "x", name: "Admin" },
    });
    return { orgId: org.id, actorId: actor.id };
  }

  it("flips a past-due subscription to active", async () => {
    const { orgId, actorId } = await pastDueOrg();
    await markSubscriptionActive({ organizationId: orgId, actorId });
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.subscriptionStatus).toBe("ACTIVE");
  });

  it("refuses an organization that isn't past-due", async () => {
    const { orgId, actorId } = await pastDueOrg();
    await prisma.organization.update({ where: { id: orgId }, data: { subscriptionStatus: "ACTIVE" } });
    await expect(markSubscriptionActive({ organizationId: orgId, actorId })).rejects.toThrow(PlatformAdminError);
  });

  it("records an audit log entry in the organization's own tenant data", async () => {
    const { orgId, actorId } = await pastDueOrg();
    await markSubscriptionActive({ organizationId: orgId, actorId });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: "SUBSCRIPTION_MARKED_ACTIVE" } });
    expect(entry.actorId).toBe(actorId);
    expect(entry.before).toMatchObject({ subscriptionStatus: "PAST_DUE" });
  });
});
