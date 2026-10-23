import crypto from "node:crypto";
import { describe, expect, it, beforeAll } from "vitest";
import { verifyWebhookSignature, parseWebhookPayload } from "@/lib/whatsapp";

beforeAll(() => {
  process.env.WHATSAPP_APP_SECRET = "test-app-secret";
});

function sign(body: string) {
  const hmac = crypto.createHmac("sha256", "test-app-secret").update(body, "utf8").digest("hex");
  return `sha256=${hmac}`;
}

describe("verifyWebhookSignature", () => {
  it("accepts a correctly signed body", () => {
    const body = JSON.stringify({ hello: "world" });
    expect(verifyWebhookSignature(body, sign(body))).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = JSON.stringify({ hello: "world" });
    const signature = sign(body);
    expect(verifyWebhookSignature(JSON.stringify({ hello: "mallory" }), signature)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyWebhookSignature(JSON.stringify({ a: 1 }), null)).toBe(false);
  });

  it("rejects when the app secret isn't configured", () => {
    const body = JSON.stringify({ a: 1 });
    const signature = sign(body);
    const original = process.env.WHATSAPP_APP_SECRET;
    delete process.env.WHATSAPP_APP_SECRET;
    expect(verifyWebhookSignature(body, signature)).toBe(false);
    process.env.WHATSAPP_APP_SECRET = original;
  });
});

describe("parseWebhookPayload", () => {
  it("extracts a text message with contact name", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "entry-1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                contacts: [{ profile: { name: "Ngozi Eze" }, wa_id: "2348031234567" }],
                messages: [
                  {
                    from: "2348031234567",
                    id: "wamid.ABC123",
                    timestamp: "1700000000",
                    type: "text",
                    text: { body: "How much is the Ankara two-piece?" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const messages = parseWebhookPayload(payload);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      externalId: "wamid.ABC123",
      from: "2348031234567",
      contactName: "Ngozi Eze",
      body: "How much is the Ankara two-piece?",
    });
    expect(messages[0].timestamp.getTime()).toBe(1700000000 * 1000);
  });

  it("labels a non-text message instead of fabricating content", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [{ from: "234800000", id: "wamid.IMG1", timestamp: "1700000001", type: "image" }],
              },
            },
          ],
        },
      ],
    };
    const messages = parseWebhookPayload(payload);
    expect(messages[0].body).toBe("[unsupported message type: image]");
  });

  it("ignores non-message changes, e.g. status updates", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "message_template_status_update", value: {} }] }],
    };
    expect(parseWebhookPayload(payload)).toHaveLength(0);
  });

  it("ignores payloads that aren't whatsapp_business_account events", () => {
    expect(parseWebhookPayload({ object: "page" })).toHaveLength(0);
    expect(parseWebhookPayload(null)).toHaveLength(0);
    expect(parseWebhookPayload("not an object")).toHaveLength(0);
  });
});
