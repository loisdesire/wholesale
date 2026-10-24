import { MessageDeliveryStatus } from "@prisma/client";
import { transaction } from "@/lib/db";
import type { InboundWhatsAppStatusUpdate } from "@/lib/whatsapp";

const STATUS_MAP: Record<InboundWhatsAppStatusUpdate["status"], MessageDeliveryStatus> = {
  sent: MessageDeliveryStatus.SENT,
  delivered: MessageDeliveryStatus.DELIVERED,
  read: MessageDeliveryStatus.READ,
  failed: MessageDeliveryStatus.FAILED,
};

/** sent < delivered < read; failed is terminal and always wins. */
const RANK: Record<MessageDeliveryStatus, number> = {
  SENT: 0,
  DELIVERED: 1,
  READ: 2,
  FAILED: 3,
};

/**
 * Applies one WhatsApp delivery-status webhook event to the Message it's about
 * (matched by externalId, the WhatsApp message id recorded when it was sent).
 * Idempotent and order-tolerant: Meta can redeliver or reorder these, so a
 * status is only ever recorded if it represents real forward progress — a late
 * "sent" arriving after "read" was already recorded never regresses it. Returns
 * null when there's nothing to apply (unknown message, or no real progress).
 */
export async function applyMessageStatus(organizationId: string, update: InboundWhatsAppStatusUpdate) {
  const status = STATUS_MAP[update.status];

  return transaction(organizationId, async (tx) => {
    const message = await tx.message.findFirst({
      where: { externalId: update.externalId, conversation: { organizationId } },
    });
    if (!message) return null;
    if (message.deliveryStatus && RANK[message.deliveryStatus] >= RANK[status]) return null;

    return tx.message.update({
      where: { id: message.id },
      data: {
        deliveryStatus: status,
        deliveryStatusAt: update.timestamp,
        deliveryError: status === MessageDeliveryStatus.FAILED ? (update.errorReason?.slice(0, 300) ?? "Delivery failed.") : null,
      },
    });
  });
}
