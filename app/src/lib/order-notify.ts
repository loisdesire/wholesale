import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { sendStaffReply } from "@/lib/inbox";
import { ensurePublicToken, trackingUrl } from "@/lib/order-tracking";

export type ShipNoticeResult = { sent: boolean; reason?: string };

/**
 * Tells the customer a shipment has gone out, on the channel they already use with the business.
 *
 * Best-effort by design: the shipment is already saved and stock already moved by the time this
 * runs, so a failed message (WhatsApp/Telegram not configured, API down, no chat on record) must
 * never undo or fail the shipment. The outcome is written to the audit trail either way, and the
 * order page always offers the tracking link to copy and send by hand.
 */
export async function notifyOrderShipped(params: {
  organizationId: string;
  orderId: string;
  shipmentId: string;
  actorId: string;
}): Promise<ShipNoticeResult> {
  const { organizationId, orderId, shipmentId, actorId } = params;

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { notifyCustomerOnShip: true } });
  if (!org?.notifyCustomerOnShip) return { sent: false, reason: "Customer shipping messages are switched off." };

  const db = tenantDb(organizationId);
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { reference: true, conversationId: true, customer: { select: { id: true, name: true, phone: true } } },
  });
  const shipment = await db.shipment.findUnique({
    where: { id: shipmentId },
    select: { carrier: true, trackingReference: true, items: { select: { quantity: true } } },
  });
  if (!order || !shipment) return { sent: false, reason: "Order or shipment not found." };

  const audit = (action: string, extra: Record<string, string>) =>
    recordAudit({ organizationId, entity: "Order", entityId: orderId, action, actorId, after: { shipmentId, ...extra } }, db);

  try {
    const conversationId =
      order.conversationId ??
      (await db.conversation.findFirst({ where: { customerId: order.customer.id }, orderBy: { lastMessageAt: "desc" }, select: { id: true } }))?.id;

    if (!conversationId) {
      await audit("SHIP_NOTICE_SKIPPED", { reason: "no conversation with this customer" });
      return { sent: false, reason: "No chat with this customer to send it on." };
    }

    const token = await ensurePublicToken(organizationId, orderId);
    const units = shipment.items.reduce((n, i) => n + i.quantity, 0);
    const first = order.customer.name?.trim().split(/\s+/)[0];
    const carrierLine = [shipment.carrier, shipment.trackingReference ? `tracking ${shipment.trackingReference}` : null].filter(Boolean).join(", ");
    const body = [
      `${first ? `Hi ${first}, ` : ""}${units} item${units === 1 ? "" : "s"} from your order ${order.reference} ${units === 1 ? "has" : "have"} shipped.`,
      carrierLine,
      // A bare path is no use inside a chat, so the link is only included once APP_URL is configured.
      (process.env.APP_URL ?? "").trim() ? `Follow your order here: ${trackingUrl(organizationId, token)}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    await sendStaffReply({ conversationId, organizationId, to: order.customer.phone, body });
    await audit("SHIP_NOTICE_SENT", { conversationId });
    return { sent: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    await audit("SHIP_NOTICE_FAILED", { reason: reason.slice(0, 300) }).catch(() => undefined);
    return { sent: false, reason };
  }
}
