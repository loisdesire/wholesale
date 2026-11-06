import { NextRequest } from "next/server";
import { resolveOrganizationForTelegram } from "@/lib/telegram-routing";
import { parseTelegramUpdate, fetchTelegramFileBytes, TelegramMediaError } from "@/lib/telegram";
import { ingestInboundMessage } from "@/lib/inbox";
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

  const organization = await resolveOrganizationForTelegram();
  if (!organization) {
    console.error("Telegram webhook: No organization found to route message to.");
    return Response.json({ ok: false, error: "unrouted" });
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

  return Response.json({
    ok: true,
    messageId: created?.id ?? null,
  });
}
