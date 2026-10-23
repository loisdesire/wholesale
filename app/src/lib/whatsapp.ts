import crypto from "node:crypto";

export function isWhatsAppConfigured() {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN &&
      process.env.WHATSAPP_PHONE_NUMBER_ID &&
      process.env.WHATSAPP_APP_SECRET &&
      process.env.WHATSAPP_VERIFY_TOKEN
  );
}

/**
 * Verifies Meta's X-Hub-Signature-256 header against the raw request body
 * using the app secret. Must run against the exact raw bytes Meta sent —
 * re-serializing parsed JSON before checking would silently break this for
 * any payload whose serialization doesn't round-trip byte-for-byte.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret || !signatureHeader) return false;

  const expected = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const provided = signatureHeader.replace(/^sha256=/, "");

  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export type InboundWhatsAppMessage = {
  externalId: string;
  from: string;
  contactName?: string;
  timestamp: Date;
  /** Human-readable body. Non-text message types get a bracketed placeholder — never fabricated content. */
  body: string;
};

/**
 * Normalizes a WhatsApp Cloud API webhook POST body into the inbound
 * messages it contains. Only `object: "whatsapp_business_account"` payloads
 * with a "messages" field are relevant — status updates (sent/delivered/read)
 * and other change types are ignored (out of Phase 1 scope).
 */
export function parseWebhookPayload(body: unknown): InboundWhatsAppMessage[] {
  const messages: InboundWhatsAppMessage[] = [];
  if (!body || typeof body !== "object" || (body as Record<string, unknown>).object !== "whatsapp_business_account") {
    return messages;
  }

  const entries = (body as { entry?: unknown[] }).entry;
  if (!Array.isArray(entries)) return messages;

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const value = (change as { field?: string; value?: Record<string, unknown> })?.value;
      if (!value || (change as { field?: string }).field !== "messages") continue;

      const contacts = (value.contacts as { profile?: { name?: string }; wa_id?: string }[]) ?? [];
      const nameByWaId = new Map(contacts.map((c) => [c.wa_id, c.profile?.name]));

      const rawMessages = (value.messages as Record<string, unknown>[]) ?? [];
      for (const m of rawMessages) {
        const from = String(m.from ?? "");
        const id = String(m.id ?? "");
        if (!from || !id) continue;

        const timestampSeconds = Number(m.timestamp ?? 0);
        const timestamp = timestampSeconds ? new Date(timestampSeconds * 1000) : new Date();

        let body: string;
        if (m.type === "text") {
          body = String((m.text as { body?: string })?.body ?? "").trim() || "[empty message]";
        } else {
          body = `[unsupported message type: ${String(m.type ?? "unknown")}]`;
        }

        messages.push({
          externalId: id,
          from,
          contactName: nameByWaId.get(from),
          timestamp,
          body,
        });
      }
    }
  }

  return messages;
}

export class WhatsAppSendError extends Error {}

/**
 * Sends a text message via the WhatsApp Cloud API. Throws on any failure —
 * callers must not record a message as sent unless this resolves, per the
 * principle that the app never claims an action it hasn't confirmed.
 */
export async function sendWhatsAppTextMessage(to: string, body: string): Promise<{ messageId: string }> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!accessToken || !phoneNumberId) {
    throw new WhatsAppSendError(
      "WhatsApp isn't configured (missing WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID)."
    );
  }

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new WhatsAppSendError(`WhatsApp send failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const json = (await res.json()) as { messages?: { id: string }[] };
  const messageId = json.messages?.[0]?.id;
  if (!messageId) {
    throw new WhatsAppSendError("WhatsApp send returned no message id.");
  }
  return { messageId };
}
