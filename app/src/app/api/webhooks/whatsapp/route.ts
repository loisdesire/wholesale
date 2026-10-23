import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
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

  // Phase 1 is single-tenant: every inbound message belongs to the one
  // organization. Multi-tenant routing (matching on phone_number_id) is a
  // Phase 3 concern.
  const organization = await prisma.organization.findFirst();
  if (!organization) {
    return new Response("No organization configured", { status: 500 });
  }

  for (const message of messages) {
    await ingestInboundMessage(organization.id, message);
  }

  return new Response("OK", { status: 200 });
}
