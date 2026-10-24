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
  /** The business phone number the message was sent to (Meta's metadata.phone_number_id) — identifies the tenant. */
  phoneNumberId?: string;
  /** Human-readable body. Non-text message types get a bracketed placeholder — never fabricated content. */
  body: string;
};

/**
 * Normalizes a WhatsApp Cloud API webhook POST body into the inbound
 * messages it contains. A status-update webhook (see `parseStatusUpdates`)
 * carries no `value.messages`, so it naturally yields nothing here.
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

      const phoneNumberId = (value.metadata as { phone_number_id?: string } | undefined)?.phone_number_id;
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
          phoneNumberId: phoneNumberId ? String(phoneNumberId) : undefined,
          body,
        });
      }
    }
  }

  return messages;
}

export type InboundWhatsAppStatusUpdate = {
  /** The externalId a message was stored under when sent — joins back to that Message. */
  externalId: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: Date;
  /** The business phone number the status update is about — identifies the tenant, same as an inbound message. */
  phoneNumberId?: string;
  /** Meta's own description, only present (and only meaningful) when status is "failed". */
  errorReason?: string;
};

const KNOWN_STATUSES = new Set(["sent", "delivered", "read", "failed"]);

/**
 * Normalizes a WhatsApp Cloud API webhook POST body into the delivery-status
 * updates it contains (sent/delivered/read/failed for a message this business
 * sent) — Meta delivers these on the same `changes[].value` shape as inbound
 * messages, just under `statuses` instead of `messages`.
 */
export function parseStatusUpdates(body: unknown): InboundWhatsAppStatusUpdate[] {
  const updates: InboundWhatsAppStatusUpdate[] = [];
  if (!body || typeof body !== "object" || (body as Record<string, unknown>).object !== "whatsapp_business_account") {
    return updates;
  }

  const entries = (body as { entry?: unknown[] }).entry;
  if (!Array.isArray(entries)) return updates;

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const value = (change as { value?: Record<string, unknown> })?.value;
      if (!value) continue;

      const phoneNumberId = (value.metadata as { phone_number_id?: string } | undefined)?.phone_number_id;
      const rawStatuses = (value.statuses as Record<string, unknown>[]) ?? [];
      for (const s of rawStatuses) {
        const id = String(s.id ?? "");
        const status = String(s.status ?? "").toLowerCase();
        if (!id || !KNOWN_STATUSES.has(status)) continue;

        const timestampSeconds = Number(s.timestamp ?? 0);
        const timestamp = timestampSeconds ? new Date(timestampSeconds * 1000) : new Date();
        const errors = s.errors as { title?: string }[] | undefined;

        updates.push({
          externalId: id,
          status: status as InboundWhatsAppStatusUpdate["status"],
          timestamp,
          phoneNumberId: phoneNumberId ? String(phoneNumberId) : undefined,
          errorReason: status === "failed" ? errors?.[0]?.title : undefined,
        });
      }
    }
  }

  return updates;
}

export class WhatsAppSendError extends Error {}

/**
 * Sends a text message via the WhatsApp Cloud API. Throws on any failure —
 * callers must not record a message as sent unless this resolves, per the
 * principle that the app never claims an action it hasn't confirmed.
 */
export async function sendWhatsAppTextMessage(
  to: string,
  body: string,
  /** The organization's own registered number; falls back to the single-tenant env setting. */
  organizationPhoneNumberId?: string | null
): Promise<{ messageId: string }> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = organizationPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
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
