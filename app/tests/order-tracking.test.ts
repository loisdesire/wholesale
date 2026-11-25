import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationChannel, StockMovementReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { phoneKeyOf } from "@/lib/phone";
import { recordStockMovement } from "@/lib/stock";
import { confirmOrder, createDraftOrder, markOrderPaid, shipOrderItems } from "@/lib/orders";
import { ensurePublicToken, getTrackingView, trackingUrl } from "@/lib/order-tracking";

// Only the outbound send is replaced; everything else in the inbox module stays real.
const sendStaffReply = vi.fn();
vi.mock("@/lib/inbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/inbox")>()),
  sendStaffReply: (...args: unknown[]) => sendStaffReply(...args),
}));
const { notifyOrderShipped } = await import("@/lib/order-notify");

describe("customer order status page and shipping messages", () => {
  let orgA: string;
  let orgB: string;
  let actorId: string;
  let n = 0;

  beforeAll(async () => {
    orgA = (await prisma.organization.create({ data: { name: "Tracking Org A" } })).id;
    orgB = (await prisma.organization.create({ data: { name: "Tracking Org B" } })).id;
    actorId = (
      await prisma.user.create({
        data: { memberships: { create: { organizationId: orgA, role: "OWNER" } }, email: "trk-owner@example.com", passwordHash: "x", name: "Owner" },
      })
    ).id;
  });

  beforeEach(() => {
    sendStaffReply.mockReset();
    sendStaffReply.mockResolvedValue({ id: "m1" });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** A paid order with 5 units of one product, optionally with a chat on record. */
  async function paidOrder(opts: { withChat?: boolean } = {}) {
    n += 1;
    const phone = `+1777${String(1000000 + n)}`;
    const customer = await prisma.customer.create({ data: { organizationId: orgA, phone, phoneKey: phoneKeyOf(phone)!, name: "Ada Obi" } });
    const conversation =
      opts.withChat === false
        ? null
        : await prisma.conversation.create({ data: { organizationId: orgA, customerId: customer.id, channel: ConversationChannel.WHATSAPP } });
    const product = await prisma.product.create({ data: { organizationId: orgA, sku: `TRK-${n}`, name: `Tracked Product ${n}`, priceCents: 10000 } });
    await recordStockMovement({ organizationId: orgA, productId: product.id, quantityDelta: 20, reason: StockMovementReason.INITIAL_STOCK });
    const draft = await createDraftOrder({
      organizationId: orgA,
      customerId: customer.id,
      conversationId: conversation?.id,
      createdById: actorId,
      items: [{ productId: product.id, quantity: 5 }],
      notes: "private staff note",
      deliveryAddress: "12 Secret Street",
    });
    const ids = { organizationId: orgA, orderId: draft.id, actorId };
    await confirmOrder({ ...ids, allowDuplicate: true });
    await markOrderPaid(ids);
    return { ids, orderId: draft.id, conversationId: conversation?.id };
  }

  describe("status page data", () => {
    it("returns the order for a valid token and keeps private details out", async () => {
      const { orderId } = await paidOrder();
      const token = await ensurePublicToken(orgA, orderId);
      const view = await getTrackingView(orgA, token);

      expect(view).not.toBeNull();
      expect(view!.businessName).toBe("Tracking Org A");
      expect(view!.status).toBe("PAID");
      expect(view!.isPaid).toBe(true);
      expect(view!.items).toHaveLength(1);
      expect(view!.items[0]).toMatchObject({ quantity: 5, shipped: 0 });

      const text = JSON.stringify(view);
      expect(text).not.toContain("Secret Street");
      expect(text).not.toContain("private staff note");
      expect(text).not.toContain("+1777");
      expect(text).not.toContain("10000");
    });

    it("gives the same token every time for one order, and different tokens for different orders", async () => {
      const a = await paidOrder();
      const b = await paidOrder();
      const t1 = await ensurePublicToken(orgA, a.orderId);
      expect(await ensurePublicToken(orgA, a.orderId)).toBe(t1);
      expect(await ensurePublicToken(orgA, b.orderId)).not.toBe(t1);
      expect(t1.length).toBeGreaterThanOrEqual(24);
    });

    it("rejects a wrong token, a malformed token, and another business's id", async () => {
      const { orderId } = await paidOrder();
      const token = await ensurePublicToken(orgA, orderId);
      expect(await getTrackingView(orgA, "x".repeat(24))).toBeNull();
      expect(await getTrackingView(orgA, "short")).toBeNull();
      expect(await getTrackingView(orgA, "../../etc/passwd-padding-padding")).toBeNull();
      // Right token, wrong business: row-level security hides the order.
      expect(await getTrackingView(orgB, token)).toBeNull();
      expect(await getTrackingView("doesnotexist1234", token)).toBeNull();
    });

    it("shows shipments and per-item progress after a part-shipment", async () => {
      const { ids, orderId } = await paidOrder();
      const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });
      await shipOrderItems({ ...ids, items: [{ orderItemId: item.id, quantity: 2 }], carrier: "GIG Logistics", trackingReference: "GIG123" });
      const view = await getTrackingView(orgA, await ensurePublicToken(orgA, orderId));
      expect(view!.status).toBe("PARTIALLY_FULFILLED");
      expect(view!.items[0]).toMatchObject({ quantity: 5, shipped: 2 });
      expect(view!.shipments).toHaveLength(1);
      expect(view!.shipments[0]).toMatchObject({ carrier: "GIG Logistics", trackingReference: "GIG123", units: 2 });
    });

    it("never shows a draft order", async () => {
      const { ids, orderId } = await paidOrder();
      const token = await ensurePublicToken(orgA, orderId);
      await prisma.order.update({ where: { id: ids.orderId }, data: { status: "DRAFT" } });
      expect(await getTrackingView(orgA, token)).toBeNull();
    });

    it("builds an absolute link when APP_URL is set and a path otherwise", () => {
      const prev = process.env.APP_URL;
      process.env.APP_URL = "https://shop.example.com/";
      expect(trackingUrl("org1", "tok")).toBe("https://shop.example.com/track/org1/tok");
      delete process.env.APP_URL;
      expect(trackingUrl("org1", "tok")).toBe("/track/org1/tok");
      if (prev !== undefined) process.env.APP_URL = prev;
    });
  });

  describe("shipping message", () => {
    it("messages the customer in their chat with the item count, carrier and link", async () => {
      const { ids, orderId, conversationId } = await paidOrder();
      const { shipment } = await shipOrderItems({ ...ids, carrier: "DHL", trackingReference: "DHL999" });

      const result = await notifyOrderShipped({ organizationId: orgA, orderId, shipmentId: shipment.id, actorId });
      expect(result).toEqual({ sent: true });

      expect(sendStaffReply).toHaveBeenCalledTimes(1);
      const arg = sendStaffReply.mock.calls[0][0] as { conversationId: string; to: string; body: string; organizationId: string };
      expect(arg.conversationId).toBe(conversationId);
      expect(arg.organizationId).toBe(orgA);
      expect(arg.body).toContain("Hi Ada");
      expect(arg.body).toContain("5 items");
      expect(arg.body).toContain("DHL, tracking DHL999");
      expect(arg.body).toContain(`/track/${orgA}/`);

      const audit = await prisma.auditLog.findFirst({ where: { entityId: orderId, action: "SHIP_NOTICE_SENT" } });
      expect(audit).not.toBeNull();
    });

    it("does not message anyone when the owner has switched it off", async () => {
      await prisma.organization.update({ where: { id: orgA }, data: { notifyCustomerOnShip: false } });
      try {
        const { ids, orderId } = await paidOrder();
        const { shipment } = await shipOrderItems(ids);
        const result = await notifyOrderShipped({ organizationId: orgA, orderId, shipmentId: shipment.id, actorId });
        expect(result.sent).toBe(false);
        expect(sendStaffReply).not.toHaveBeenCalled();
      } finally {
        await prisma.organization.update({ where: { id: orgA }, data: { notifyCustomerOnShip: true } });
      }
    });

    it("skips quietly when the customer has no chat on record", async () => {
      const { ids, orderId } = await paidOrder({ withChat: false });
      const { shipment } = await shipOrderItems(ids);
      const result = await notifyOrderShipped({ organizationId: orgA, orderId, shipmentId: shipment.id, actorId });
      expect(result.sent).toBe(false);
      expect(sendStaffReply).not.toHaveBeenCalled();
      expect(await prisma.auditLog.findFirst({ where: { entityId: orderId, action: "SHIP_NOTICE_SKIPPED" } })).not.toBeNull();
    });

    it("never throws when sending fails: the shipment stands and the failure is recorded", async () => {
      sendStaffReply.mockRejectedValue(new Error("WhatsApp is not configured"));
      const { ids, orderId } = await paidOrder();
      const { shipment } = await shipOrderItems(ids);

      const result = await notifyOrderShipped({ organizationId: orgA, orderId, shipmentId: shipment.id, actorId });
      expect(result).toEqual({ sent: false, reason: "WhatsApp is not configured" });

      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe("FULFILLED");
      expect(await prisma.auditLog.findFirst({ where: { entityId: orderId, action: "SHIP_NOTICE_FAILED" } })).not.toBeNull();
    });
  });
});
