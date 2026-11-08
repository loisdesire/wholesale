import { NextRequest } from "next/server";
import { resolveOrganizationForTelegram } from "@/lib/telegram-routing";
import { parseTelegramUpdate, fetchTelegramFileBytes, TelegramMediaError } from "@/lib/telegram";
import { ingestInboundMessage, dispatchAIAssistReply } from "@/lib/inbox";
import { isAIConfigured } from "@/lib/ai/engine";
import { ConversationChannel } from "@prisma/client";

/**
 * Health-check / verify endpoint for Telegram webhook testing.
 */
export async function GET() {
  return Response.json({
    ok: true,
    provider: "telegram",
    status: "active",
    timestamp: new Date().toISOString(),
  });
}

/**
 * Inbound webhook handler for Telegram Bot updates.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const message = parseTelegramUpdate(body);
  if (!message) {
    // Acknowledge non-message updates (e.g. channel posts, poll answers)
    return Response.json({ ok: true, ignored: true });
  }

  const { searchParams } = new URL(req.url);
  const token =
    searchParams.get("token") ||
    searchParams.get("secret") ||
    req.headers.get("x-telegram-bot-api-secret-token") ||
    process.env.TELEGRAM_BOT_TOKEN;

  const organization = await resolveOrganizationForTelegram(token);
  if (!organization) {
    console.warn("Telegram webhook: Message matches no organization (unrouted) — not stored.");
    return Response.json({ ok: true, ignored: true, error: "unrouted" });
  }

  let attachment: { data: Buffer; mimeType: string } | undefined;
  if (message.media) {
    try {
      attachment = await fetchTelegramFileBytes(message.media.fileId, organization.telegramBotToken);
    } catch (err) {
      const detail = err instanceof TelegramMediaError ? err.message : String(err);
      console.warn(`Telegram webhook: Could not download media ${message.media.fileId}: ${detail}`);
    }
  }

  const created = await ingestInboundMessage(
    organization.id,
    {
      ...message,
      channel: ConversationChannel.TELEGRAM,
    },
    attachment
  );

  if (created && isAIConfigured()) {
    dispatchAIAssistReply({
      organizationId: organization.id,
      conversationId: created.conversationId,
    }).catch((err) => console.warn("Telegram webhook AI dispatch failed:", err));
  }

  return Response.json({
    ok: true,
    messageId: created?.id ?? null,
  });
}
