import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi, beforeAll } from "vitest";
import { verifyWebhookSignature, parseWebhookPayload, parseStatusUpdates, fetchMediaBytes, WhatsAppMediaError } from "@/lib/whatsapp";

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

  it("labels a genuinely unsupported message type instead of fabricating content", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [{ from: "234800000", id: "wamid.VID1", timestamp: "1700000001", type: "video" }],
              },
            },
          ],
        },
      ],
    };
    const messages = parseWebhookPayload(payload);
    expect(messages[0].body).toBe("[unsupported message type: video]");
    expect(messages[0].media).toBeUndefined();
  });

  it("extracts an image message's media id and mime type, with its caption as the body", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [
                  {
                    from: "234800000",
                    id: "wamid.IMG1",
                    timestamp: "1700000001",
                    type: "image",
                    image: { id: "media-123", mime_type: "image/jpeg", caption: "Can I get this in medium?" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const messages = parseWebhookPayload(payload);
    expect(messages[0].body).toBe("Can I get this in medium?");
    expect(messages[0].media).toEqual({ mediaId: "media-123", mimeType: "image/jpeg" });
  });

  it("falls back to an [image] placeholder body when there's no caption", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [{ from: "234800000", id: "wamid.IMG2", timestamp: "1700000001", type: "image", image: { id: "media-456", mime_type: "image/png" } }],
              },
            },
          ],
        },
      ],
    };
    const messages = parseWebhookPayload(payload);
    expect(messages[0].body).toBe("[image]");
    expect(messages[0].media).toEqual({ mediaId: "media-456", mimeType: "image/png" });
  });

  it("never fabricates media info when the image payload is malformed", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [{ from: "234800000", id: "wamid.IMG3", timestamp: "1700000001", type: "image" }],
              },
            },
          ],
        },
      ],
    };
    const messages = parseWebhookPayload(payload);
    expect(messages[0].body).toBe("[image]");
    expect(messages[0].media).toBeUndefined();
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

describe("parseStatusUpdates", () => {
  it("extracts a delivered status with its phone number id", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "biz-phone-1" },
                statuses: [{ id: "wamid.OUT1", status: "delivered", timestamp: "1700000100" }],
              },
            },
          ],
        },
      ],
    };
    const updates = parseStatusUpdates(payload);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ externalId: "wamid.OUT1", status: "delivered", phoneNumberId: "biz-phone-1" });
    expect(updates[0].timestamp.getTime()).toBe(1700000100 * 1000);
  });

  it("captures the failure reason only for a failed status", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                statuses: [
                  { id: "wamid.OUT2", status: "failed", timestamp: "1700000200", errors: [{ title: "Recipient opted out" }] },
                  { id: "wamid.OUT3", status: "sent", timestamp: "1700000201" },
                ],
              },
            },
          ],
        },
      ],
    };
    const updates = parseStatusUpdates(payload);
    expect(updates.find((u) => u.externalId === "wamid.OUT2")?.errorReason).toBe("Recipient opted out");
    expect(updates.find((u) => u.externalId === "wamid.OUT3")?.errorReason).toBeUndefined();
  });

  it("ignores an unrecognized status value rather than guessing", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "wamid.OUT4", status: "deleted", timestamp: "1700000300" }] } }] }],
    };
    expect(parseStatusUpdates(payload)).toHaveLength(0);
  });

  it("extracts nothing from a plain inbound-message payload, and vice versa", () => {
    const messagePayload = {
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { messages: [{ from: "1", id: "wamid.IN1", timestamp: "1700000400", type: "text", text: { body: "hi" } }] } }] }],
    };
    expect(parseStatusUpdates(messagePayload)).toHaveLength(0);

    const statusPayload = {
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "wamid.OUT5", status: "sent", timestamp: "1700000500" }] } }] }],
    };
    expect(parseWebhookPayload(statusPayload)).toHaveLength(0);
  });

  it("ignores payloads that aren't whatsapp_business_account events", () => {
    expect(parseStatusUpdates({ object: "page" })).toHaveLength(0);
    expect(parseStatusUpdates(null)).toHaveLength(0);
  });
});

describe("fetchMediaBytes", () => {
  beforeEach(() => {
    process.env.WHATSAPP_ACCESS_TOKEN = "media-test-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses when WhatsApp isn't configured", async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    await expect(fetchMediaBytes("media-1")).rejects.toBeInstanceOf(WhatsAppMediaError);
  });

  it("resolves the media id to a URL, then downloads it", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://lookaside.example/media-1", mime_type: "image/jpeg", file_size: 4 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(bytes, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMediaBytes("media-1");
    expect(result.mimeType).toBe("image/jpeg");
    expect(Buffer.from(result.data)).toEqual(Buffer.from(bytes));

    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://graph.facebook.com/v21.0/media-1", expect.objectContaining({ headers: { Authorization: "Bearer media-test-token" } }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://lookaside.example/media-1", expect.objectContaining({ headers: { Authorization: "Bearer media-test-token" } }));
  });

  it("refuses a file Meta itself reports as too large, without downloading it", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ url: "https://lookaside.example/big", mime_type: "image/jpeg", file_size: 50 * 1024 * 1024 }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchMediaBytes("media-big")).rejects.toBeInstanceOf(WhatsAppMediaError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // never attempted the download
  });

  it("surfaces a failure to resolve the media id cleanly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not found", { status: 404 })));
    await expect(fetchMediaBytes("media-gone")).rejects.toThrow(/Could not resolve media/);
  });
});
