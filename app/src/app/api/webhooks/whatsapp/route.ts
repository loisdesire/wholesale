import { NextRequest } from "next/server";
import { resolveOrganizationForWhatsApp } from "@/lib/whatsapp-routing";
import { verifyWebhookSignature, parseWebhookPayload } from "@/lib/whatsapp";
import { ingestInboundMessage } from "@/lib/inbox";

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
  if (messages.length === 0) {
    // Not a message event (e.g. a status update) — acknowledge and move on.
    return new Response("OK", { status: 200 });
  }

  // Route each message to the organization that owns the WhatsApp number it was
  // sent to. A message we can't attribute to exactly one organization is not stored
  // (filing it under a guess would leak one tenant's customer into another's inbox);
  // it is logged loudly, and acknowledged so Meta doesn't retry it forever.
  const organizationCache = new Map<string, string | null>();
  let unrouted = 0;
  for (const message of messages) {
    const key = message.phoneNumberId ?? "";
    if (!organizationCache.has(key)) {
      organizationCache.set(key, (await resolveOrganizationForWhatsApp(message.phoneNumberId))?.id ?? null);
    }
    const organizationId = organizationCache.get(key);
    if (!organizationId) {
      unrouted += 1;
      console.error(
        `WhatsApp webhook: message ${message.externalId} for phone number id "${key || "(none)"}" matches no organization — not stored.`
      );
      continue;
    }
    await ingestInboundMessage(organizationId, message);
  }
  if (unrouted > 0) return new Response(`OK (${unrouted} unrouted message(s) not stored)`, { status: 200 });

  return new Response("OK", { status: 200 });
}
