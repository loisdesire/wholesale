import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET, POST } from "@/app/api/webhooks/whatsapp/route";

const APP_SECRET = "route-test-secret";
const VERIFY_TOKEN = "route-test-verify-token";
const ROUTE_PHONE_ID = "route-test-phone-1";

function sign(body: string) {
  return `sha256=${crypto.createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex")}`;
}

describe("WhatsApp webhook route", () => {
  beforeAll(async () => {
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
    process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;
    await prisma.organization.create({
      data: { name: "Webhook Route Test Org", whatsappPhoneNumberId: ROUTE_PHONE_ID },
    });
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
                metadata: { phone_number_id: ROUTE_PHONE_ID },
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
                metadata: { phone_number_id: ROUTE_PHONE_ID },
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

  describe("routing to the right organization", () => {
    function post(phoneNumberId: string | undefined, from: string, id: string, text: string) {
      const body = JSON.stringify({
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                field: "messages",
                value: {
                  ...(phoneNumberId ? { metadata: { phone_number_id: phoneNumberId } } : {}),
                  messages: [
                    { from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } },
                  ],
                },
              },
            ],
          },
        ],
      });
      return POST(
        new NextRequest("http://localhost/api/webhooks/whatsapp", {
          method: "POST",
          body,
          headers: { "x-hub-signature-256": sign(body) },
        })
      );
    }

    it("files each message under the organization that owns the number it was sent to", async () => {
      const second = await prisma.organization.create({
        data: { name: "Second Tenant", whatsappPhoneNumberId: "route-test-phone-2" },
      });
      const first = await prisma.organization.findUniqueOrThrow({ where: { whatsappPhoneNumberId: ROUTE_PHONE_ID } });

      // Same customer phone writes to both businesses: two separate customers, one per tenant.
      expect((await post(ROUTE_PHONE_ID, "15558880001", "wamid.rt-a", "hello first")).status).toBe(200);
      expect((await post("route-test-phone-2", "15558880001", "wamid.rt-b", "hello second")).status).toBe(200);

      const customers = await prisma.customer.findMany({ where: { phoneKey: "15558880001" } });
      expect(customers.map((c) => c.organizationId).sort()).toEqual([first.id, second.id].sort());
      const convoOf = async (organizationId: string) =>
        prisma.conversation.findFirstOrThrow({ where: { organizationId, customer: { phoneKey: "15558880001" } }, include: { messages: true } });
      expect((await convoOf(first.id)).messages.map((m) => m.body)).toEqual(["hello first"]);
      expect((await convoOf(second.id)).messages.map((m) => m.body)).toEqual(["hello second"]);
    });

    it("does not store a message for a number no organization owns, and says so", async () => {
      const res = await post("route-test-unknown", "15558880002", "wamid.rt-unknown", "who am I?");
      expect(res.status).toBe(200); // acknowledged so Meta doesn't retry forever…
      expect(await res.text()).toMatch(/unrouted/);
      expect(await prisma.message.count({ where: { externalId: "wamid.rt-unknown" } })).toBe(0); // …but never stored
      expect(await prisma.customer.count({ where: { phoneKey: "15558880002" } })).toBe(0);
    });

    it("with several organizations, a message that names no number is not guessed at", async () => {
      const res = await post(undefined, "15558880003", "wamid.rt-nometa", "no metadata");
      expect(await res.text()).toMatch(/unrouted/);
      expect(await prisma.message.count({ where: { externalId: "wamid.rt-nometa" } })).toBe(0);
    });
  });
});
