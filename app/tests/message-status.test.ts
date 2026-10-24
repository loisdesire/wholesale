import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { applyMessageStatus } from "@/lib/message-status";

describe("applyMessageStatus", () => {
  let organizationId: string;
  let otherOrganizationId: string;
  let messageId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "Message Status Org" } });
    organizationId = org.id;
    otherOrganizationId = (await prisma.organization.create({ data: { name: "Message Status Other Org" } })).id;
    const customer = await prisma.customer.create({
      data: { organizationId, phone: "+1555777000", phoneKey: "1555777000", name: "Status Customer" },
    });
    const conversation = await prisma.conversation.create({ data: { organizationId, customerId: customer.id } });
    const message = await prisma.message.create({
      data: { conversationId: conversation.id, direction: "OUTBOUND", sender: "STAFF", body: "Your order is confirmed", externalId: "wamid.status-1" },
    });
    messageId = message.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("records forward progress (sent, delivered, read), and never regresses on a late or redelivered earlier status", async () => {
    await applyMessageStatus(organizationId, { externalId: "wamid.status-1", status: "sent", timestamp: new Date() });
    expect((await prisma.message.findUniqueOrThrow({ where: { id: messageId } })).deliveryStatus).toBe("SENT");

    await applyMessageStatus(organizationId, { externalId: "wamid.status-1", status: "delivered", timestamp: new Date() });
    expect((await prisma.message.findUniqueOrThrow({ where: { id: messageId } })).deliveryStatus).toBe("DELIVERED");

    await applyMessageStatus(organizationId, { externalId: "wamid.status-1", status: "read", timestamp: new Date() });
    expect((await prisma.message.findUniqueOrThrow({ where: { id: messageId } })).deliveryStatus).toBe("READ");

    // Meta redelivers/reorders webhooks — a late "sent" or "delivered" after "read" must not regress it.
    await applyMessageStatus(organizationId, { externalId: "wamid.status-1", status: "delivered", timestamp: new Date() });
    await applyMessageStatus(organizationId, { externalId: "wamid.status-1", status: "sent", timestamp: new Date() });
    expect((await prisma.message.findUniqueOrThrow({ where: { id: messageId } })).deliveryStatus).toBe("READ");
  });

  it("records a failure reason, truncated, and resets it if a later real status arrives", async () => {
    const customer = await prisma.customer.create({
      data: { organizationId, phone: "+1555777001", phoneKey: "1555777001", name: "Status Customer 2" },
    });
    const conversation = await prisma.conversation.create({ data: { organizationId, customerId: customer.id } });
    const message = await prisma.message.create({
      data: { conversationId: conversation.id, direction: "OUTBOUND", sender: "AI", body: "Hi", externalId: "wamid.status-2" },
    });

    await applyMessageStatus(organizationId, { externalId: "wamid.status-2", status: "failed", timestamp: new Date(), errorReason: "a".repeat(400) });
    const failed = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(failed.deliveryStatus).toBe("FAILED");
    expect(failed.deliveryError).toHaveLength(300);

    // failed outranks everything else — a later "sent"/"delivered" for the same message never un-fails it.
    await applyMessageStatus(organizationId, { externalId: "wamid.status-2", status: "delivered", timestamp: new Date() });
    expect((await prisma.message.findUniqueOrThrow({ where: { id: message.id } })).deliveryStatus).toBe("FAILED");
  });

  it("does nothing for an unknown externalId — never fabricates a message to attach a status to", async () => {
    const result = await applyMessageStatus(organizationId, { externalId: "wamid.does-not-exist", status: "read", timestamp: new Date() });
    expect(result).toBeNull();
  });

  it("never applies a status to another organization's message, even with the right externalId", async () => {
    const result = await applyMessageStatus(otherOrganizationId, { externalId: "wamid.status-1", status: "read", timestamp: new Date() });
    expect(result).toBeNull();
    expect((await prisma.message.findUniqueOrThrow({ where: { id: messageId } })).deliveryStatus).toBe("READ"); // untouched
  });
});
