"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { tenantDb, transaction } from "@/lib/db";
import { sendStaffReply, markConversationResolved, WhatsAppSendError } from "@/lib/inbox";
import { sendWhatsAppTextMessage } from "@/lib/whatsapp";
import { runAIAssist, isAIConfigured } from "@/lib/ai/engine";

export type FormState = { error: string | null };

export type AIAssistState = {
  error: string | null;
  replyText?: string;
  sent?: boolean;
  draftOrderReference?: string;
};

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");
  return session;
}

const replySchema = z.object({
  body: z.string().trim().min(1, "Write a message before sending.").max(4096),
});

export async function sendReplyAction(
  conversationId: string,
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await requireSession();

  const parsed = replySchema.safeParse({ body: formData.get("body") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid message." };
  }

  const conversation = await tenantDb(session.user.organizationId).conversation.findFirst({
    where: { id: conversationId, organizationId: session.user.organizationId },
    include: { customer: true },
  });
  if (!conversation) return { error: "Conversation not found." };

  try {
    await sendStaffReply({
      conversationId,
      organizationId: session.user.organizationId,
      to: conversation.customer.phone,
      body: parsed.data.body,
    });
  } catch (err) {
    if (err instanceof WhatsAppSendError) {
      return { error: err.message };
    }
    throw err;
  }

  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
  return { error: null };
}

export async function markResolvedAction(conversationId: string): Promise<void> {
  const session = await requireSession();
  await markConversationResolved({ conversationId, organizationId: session.user.organizationId });
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
}

/**
 * Runs the AI product-matching assist for a conversation: searches the
 * catalogue, optionally drafts an order (never confirms it), and proposes a
 * reply. The reply is only ever recorded as sent if the WhatsApp API call
 * actually succeeds — if it can't be sent (not configured, or the call
 * fails), the proposed text is still returned to staff, clearly marked as
 * not sent, rather than silently claiming otherwise.
 */
export async function runAIAssistAction(conversationId: string): Promise<AIAssistState> {
  const session = await requireSession();

  if (!isAIConfigured()) {
    return { error: "AI assist isn't configured (missing ANTHROPIC_API_KEY)." };
  }

  const conversation = await tenantDb(session.user.organizationId).conversation.findFirst({
    where: { id: conversationId, organizationId: session.user.organizationId },
    include: { customer: true },
  });
  if (!conversation) return { error: "Conversation not found." };

  let result;
  try {
    result = await runAIAssist({
      organizationId: session.user.organizationId,
      conversationId,
      customerId: conversation.customerId,
      createdById: session.user.id,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "AI assist failed." };
  }

  let sent = false;
  try {
    const organization = await prisma.organization.findUnique({ where: { id: session.user.organizationId } });
    const { messageId } = await sendWhatsAppTextMessage(
      conversation.customer.phone,
      result.replyText,
      organization?.whatsappPhoneNumberId
    );
    await transaction(session.user.organizationId, async (tx) => {
      await tx.message.create({
        data: {
          conversationId,
          direction: "OUTBOUND",
          sender: "AI",
          body: result.replyText,
          externalId: messageId,
        },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date(), status: "AI_HANDLING" },
      });
    });
    sent = true;
  } catch {
    // Not configured, or the send failed — surface the proposed reply
    // without ever claiming it reached the customer.
    sent = false;
  }

  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
  revalidatePath("/orders");
  revalidatePath("/catalogue");

  return {
    error: null,
    replyText: result.replyText,
    sent,
    draftOrderReference: result.draftOrder?.reference,
  };
}
