import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ingestInboundMessage } from "@/lib/inbox";
import type { InboundWhatsAppMessage } from "@/lib/whatsapp";

describe("ingestInboundMessage", () => {
  let organizationId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "Inbox Test Org" } });
    organizationId = org.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function message(overrides: Partial<InboundWhatsAppMessage> = {}): InboundWhatsAppMessage {
    return {
      externalId: "wamid.test-1",
      from: "15550001111",
      contactName: "Test Customer",
      timestamp: new Date(),
      body: "Hi, do you have this in stock?",
      ...overrides,
    };
  }

  it("creates a new customer and conversation on first contact", async () => {
    const result = await ingestInboundMessage(organizationId, message());
    expect(result).not.toBeNull();

    const customer = await prisma.customer.findUniqueOrThrow({
      where: { organizationId_phone: { organizationId, phone: "15550001111" } },
    });
    expect(customer.name).toBe("Test Customer");

    const conversation = await prisma.conversation.findFirstOrThrow({
      where: { organizationId, customerId: customer.id },
    });
    expect(conversation.status).toBe("NEW");

    const stored = await prisma.message.findUnique({ where: { externalId: "wamid.test-1" } });
    expect(stored?.body).toBe("Hi, do you have this in stock?");
  });

  it("reuses the existing open conversation for a second message from the same customer", async () => {
    await ingestInboundMessage(
      organizationId,
      message({ externalId: "wamid.test-2", body: "Also, how much is delivery?" })
    );

    const conversations = await prisma.conversation.findMany({
      where: { organizationId, customer: { phone: "15550001111" } },
    });
    expect(conversations).toHaveLength(1);

    const messages = await prisma.message.findMany({ where: { conversationId: conversations[0].id } });
    expect(messages).toHaveLength(2);
  });

  it("is idempotent — redelivering the same webhook event stores nothing new", async () => {
    const before = await prisma.message.count();
    const result = await ingestInboundMessage(organizationId, message()); // same externalId as test 1
    expect(result).toBeNull();
    expect(await prisma.message.count()).toBe(before);
  });

  it("reopens a resolved conversation when the customer messages again", async () => {
    const phone = "15550002222";
    await ingestInboundMessage(organizationId, message({ externalId: "wamid.r1", from: phone }));
    const conversation = await prisma.conversation.findFirstOrThrow({
      where: { organizationId, customer: { phone } },
    });
    await prisma.conversation.update({ where: { id: conversation.id }, data: { status: "RESOLVED" } });

    await ingestInboundMessage(organizationId, message({ externalId: "wamid.r2", from: phone }));

    const conversations = await prisma.conversation.findMany({
      where: { organizationId, customer: { phone } },
      orderBy: { createdAt: "asc" },
    });
    // A new conversation is opened rather than appending to the resolved one.
    expect(conversations).toHaveLength(2);
    expect(conversations[1].status).toBe("NEW");
  });
});
