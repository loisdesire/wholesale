import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET, POST } from "@/app/api/webhooks/whatsapp/route";

const APP_SECRET = "route-test-secret";
const VERIFY_TOKEN = "route-test-verify-token";

function sign(body: string) {
  return `sha256=${crypto.createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex")}`;
}

describe("WhatsApp webhook route", () => {
  beforeAll(async () => {
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
    process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;
    await prisma.organization.create({ data: { name: "Webhook Route Test Org" } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("GET confirms the handshake when the verify token matches", async () => {
    const url = `http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=echo-123`;
    const res = await GET(new NextRequest(url));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("echo-123");
  });

  it("GET refuses the handshake when the verify token is wrong", async () => {
    const url = `http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=echo-123`;
    const res = await GET(new NextRequest(url));
    expect(res.status).toBe(403);
  });

  it("POST rejects a request with no valid signature", async () => {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const req = new NextRequest("http://localhost/api/webhooks/whatsapp", {
      method: "POST",
      body,
      headers: { "x-hub-signature-256": "sha256=deadbeef" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("POST ingests a correctly signed inbound message end to end", async () => {
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                contacts: [{ profile: { name: "Route Test Customer" }, wa_id: "15559990000" }],
                messages: [
                  {
                    from: "15559990000",
                    id: "wamid.route-test-1",
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: "text",
                    text: { body: "Is the Lace gown still available?" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const req = new NextRequest("http://localhost/api/webhooks/whatsapp", {
      method: "POST",
      body,
      headers: { "x-hub-signature-256": sign(body) },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const stored = await prisma.message.findUnique({ where: { externalId: "wamid.route-test-1" } });
    expect(stored?.body).toBe("Is the Lace gown still available?");

    const customer = await prisma.customer.findFirst({ where: { phoneKey: "15559990000" } });
    expect(customer?.name).toBe("Route Test Customer");
  });

  it("POST redelivery of the same event does not duplicate the message", async () => {
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [
                  {
                    from: "15559990000",
                    id: "wamid.route-test-1", // same id as the previous test
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: "text",
                    text: { body: "Is the Lace gown still available?" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const before = await prisma.message.count();

    const req = new NextRequest("http://localhost/api/webhooks/whatsapp", {
      method: "POST",
      body,
      headers: { "x-hub-signature-256": sign(body) },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await prisma.message.count()).toBe(before);
  });
});
