import { ConversationStatus, ConversationChannel, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tenantDb, transaction } from "@/lib/db";
import { findOrCreateCustomerByPhoneTx } from "@/lib/customers";
import { sendWhatsAppTextMessage, WhatsAppSendError } from "@/lib/whatsapp";
import { sendTelegramTextMessage, TelegramSendError } from "@/lib/telegram";

export type InboundChannelMessage = {
  externalId: string;
  from: string;
  contactName?: string;
  timestamp: Date;
  body: string;
  channel?: ConversationChannel;
  media?: { mediaId?: string; fileId?: string; mimeType: string };
};

/**
 * Stores one inbound message from WhatsApp or Telegram: finds or creates the customer and an
 * open conversation for them, then inserts the message. Idempotent on
 * Message.externalId — a webhook redelivery is detected via the unique-constraint violation and
 * treated as a no-op rather than creating a duplicate message.
 *
 * `attachment`, if given, is already-downloaded image or voice bytes.
 */
export async function ingestInboundMessage(
  organizationId: string,
  message: InboundChannelMessage,
  attachment?: { data: Buffer; mimeType: string }
) {
  const channel = message.channel || ConversationChannel.WHATSAPP;

  return transaction(organizationId, async (tx) => {
    // Matched on the normalized phone/identifier so duplicates are prevented
    const customer = await findOrCreateCustomerByPhoneTx(tx, organizationId, message.from, message.contactName);

    let conversation = await tx.conversation.findFirst({
      where: {
        organizationId,
        customerId: customer.id,
        channel,
        status: { not: ConversationStatus.RESOLVED },
      },
      orderBy: { lastMessageAt: "desc" },
    });
    if (!conversation) {
      conversation = await tx.conversation.create({
        data: {
          organizationId,
          customerId: customer.id,
          channel,
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
 * Sends a staff reply over WhatsApp or Telegram and only records it as a Message once
 * the send actually succeeds — never claim a message went out that didn't.
 */
export async function sendStaffReply(params: {
  conversationId: string;
  organizationId: string;
  to: string;
  body: string;
}) {
  const organization = await prisma.organization.findUnique({ where: { id: params.organizationId } });
  const db = tenantDb(params.organizationId);
  const conv = await db.conversation.findUnique({
    where: { id: params.conversationId },
    select: { channel: true },
  });

  let messageId: string;
  if (conv?.channel === ConversationChannel.TELEGRAM) {
    const res = await sendTelegramTextMessage(params.to, params.body, organization?.telegramBotToken);
    messageId = res.messageId;
  } else {
    const res = await sendWhatsAppTextMessage(params.to, params.body, organization?.whatsappPhoneNumberId);
    messageId = res.messageId;
  }

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

export { WhatsAppSendError, TelegramSendError };
