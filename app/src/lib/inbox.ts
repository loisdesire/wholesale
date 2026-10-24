import { ConversationStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tenantDb, transaction } from "@/lib/db";
import { findOrCreateCustomerByPhoneTx } from "@/lib/customers";
import type { InboundWhatsAppMessage } from "@/lib/whatsapp";
import { sendWhatsAppTextMessage, WhatsAppSendError } from "@/lib/whatsapp";

/**
 * Stores one inbound WhatsApp message: finds or creates the customer and an
 * open conversation for them, then inserts the message. Idempotent on
 * Message.externalId — a webhook Meta redelivers (their retry policy, or a
 * duplicate event) is detected via the unique-constraint violation and
 * treated as a no-op rather than creating a duplicate message.
 *
 * `attachment`, if given, is already-downloaded image bytes (see
 * src/lib/whatsapp.ts's fetchMediaBytes) — downloading is network I/O and deliberately happens
 * outside this function's transaction, at the webhook route's call site, so a failed download
 * never blocks the message itself from being saved (the route logs it and moves on, same as
 * every other "couldn't fully apply, but acknowledge" case there).
 *
 * Returns null when the message was already recorded (duplicate delivery).
 */
export async function ingestInboundMessage(
  organizationId: string,
  message: InboundWhatsAppMessage,
  attachment?: { data: Buffer; mimeType: string }
) {
  return transaction(organizationId, async (tx) => {
    // Matched on the normalized phone, so WhatsApp's "2348031234567" finds the
    // customer staff entered as "0803 123 4567" instead of creating a second one.
    const customer = await findOrCreateCustomerByPhoneTx(tx, organizationId, message.from, message.contactName);

    let conversation = await tx.conversation.findFirst({
      where: {
        organizationId,
        customerId: customer.id,
        channel: "WHATSAPP",
        status: { not: ConversationStatus.RESOLVED },
      },
      orderBy: { lastMessageAt: "desc" },
    });
    if (!conversation) {
      conversation = await tx.conversation.create({
        data: {
          organizationId,
          customerId: customer.id,
          channel: "WHATSAPP",
          status: ConversationStatus.NEW,
          lastMessageAt: message.timestamp,
        },
      });
    }

    try {
      const created = await tx.message.create({
        data: {
          conversationId: conversation.id,
          direction: "INBOUND",
          sender: "CUSTOMER",
          body: message.body,
          externalId: message.externalId,
          createdAt: message.timestamp,
        },
      });

      if (attachment) {
        await tx.messageAttachment.create({
          data: {
            messageId: created.id,
            mimeType: attachment.mimeType,
            data: new Uint8Array(attachment.data),
            sizeBytes: attachment.data.byteLength,
          },
        });
      }

      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: message.timestamp,
          // A customer messaging back into a resolved/AI-handled thread needs
          // a human to notice; anything already further along stays as-is.
          status:
            conversation.status === ConversationStatus.AI_HANDLING
              ? ConversationStatus.AI_HANDLING
              : ConversationStatus.NEW,
        },
      });

      return created;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return null;
      }
      throw err;
    }
  });
}

/**
 * Sends a staff reply over WhatsApp and only records it as a Message once
 * the send actually succeeds — never claim a message went out that didn't.
 */
export async function sendStaffReply(params: {
  conversationId: string;
  organizationId: string;
  to: string;
  body: string;
}) {
  const organization = await prisma.organization.findUnique({ where: { id: params.organizationId } });
  const { messageId } = await sendWhatsAppTextMessage(params.to, params.body, organization?.whatsappPhoneNumberId);

  return transaction(params.organizationId, async (tx) => {
    const message = await tx.message.create({
      data: {
        conversationId: params.conversationId,
        direction: "OUTBOUND",
        sender: "STAFF",
        body: params.body,
        externalId: messageId,
      },
    });
    // Status is left alone here — replying is an action, not a state
    // decision. Staff marks a conversation resolved explicitly; a new
    // inbound message reopens it (see ingestInboundMessage).
    await tx.conversation.update({
      where: { id: params.conversationId },
      data: { lastMessageAt: new Date() },
    });
    return message;
  });
}

export async function markConversationResolved(params: { conversationId: string; organizationId: string }) {
  const db = tenantDb(params.organizationId);
  const conversation = await db.conversation.findFirst({
    where: { id: params.conversationId, organizationId: params.organizationId },
  });
  if (!conversation) throw new Error("Conversation not found.");

  return db.conversation.update({
    where: { id: conversation.id },
    data: { status: ConversationStatus.RESOLVED },
  });
}

export { WhatsAppSendError };
