import { NextRequest } from "next/server";
import { resolveOrganizationForWhatsApp } from "@/lib/whatsapp-routing";
import { verifyWebhookSignature, parseWebhookPayload, parseStatusUpdates } from "@/lib/whatsapp";
import { ingestInboundMessage } from "@/lib/inbox";
import { applyMessageStatus } from "@/lib/message-status";

/**
 * Meta's one-time webhook verification handshake, run when the webhook URL
 * is registered in the Meta app dashboard.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && challenge && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  // Signature verification needs the exact raw bytes Meta sent — read as
  // text before any JSON parsing, and never re-serialize-then-check.
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  if (!verifyWebhookSignature(rawBody, signature)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const messages = parseWebhookPayload(payload);
  const statusUpdates = parseStatusUpdates(payload);

  // Route each event to the organization that owns the WhatsApp number it's about.
  // One we can't attribute to exactly one organization is not stored (filing it under
  // a guess would leak one tenant's customer into another's inbox, or apply a status
  // to the wrong tenant's message); it is logged loudly, and acknowledged so Meta
  // doesn't retry it forever.
  const organizationCache = new Map<string, string | null>();
  async function resolve(phoneNumberId: string | undefined) {
    const key = phoneNumberId ?? "";
    if (!organizationCache.has(key)) {
      organizationCache.set(key, (await resolveOrganizationForWhatsApp(phoneNumberId))?.id ?? null);
    }
    return organizationCache.get(key) ?? null;
  }

  let unrouted = 0;
  for (const message of messages) {
    const organizationId = await resolve(message.phoneNumberId);
    if (!organizationId) {
      unrouted += 1;
      console.error(
        `WhatsApp webhook: message ${message.externalId} for phone number id "${message.phoneNumberId || "(none)"}" matches no organization — not stored.`
      );
      continue;
    }
    await ingestInboundMessage(organizationId, message);
  }

  let unroutedStatuses = 0;
  for (const update of statusUpdates) {
    const organizationId = await resolve(update.phoneNumberId);
    if (!organizationId) {
      unroutedStatuses += 1;
      console.error(
        `WhatsApp webhook: status update for ${update.externalId} ("${update.status}") on phone number id "${update.phoneNumberId || "(none)"}" matches no organization — not applied.`
      );
      continue;
    }
    await applyMessageStatus(organizationId, update);
  }

  if (unrouted > 0 || unroutedStatuses > 0) {
    return new Response(`OK (${unrouted} unrouted message(s), ${unroutedStatuses} unrouted status update(s) not applied)`, { status: 200 });
  }

  return new Response("OK", { status: 200 });
}
