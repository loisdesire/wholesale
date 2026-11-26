import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function MockOpenAI(this: { chat: { completions: { create: typeof mockCreate } } }) {
    this.chat = { completions: { create: mockCreate } };
  }),
}));

import { prisma } from "@/lib/prisma";
import { phoneKeyOf } from "@/lib/phone";
import { dispatchAIAssistReply } from "@/lib/inbox";
import { InsufficientStockError } from "@/lib/stock";
import { isSessionRevoked, revokeSession } from "@/lib/session-revocation";
import { parseProductsCsv } from "@/lib/csv";
import { cleanupFixture } from "@/lib/ai/eval";
import { recentCustomersForPicker, searchCustomersForPicker } from "@/lib/customer-picker";
import { createDraftOrder } from "@/lib/orders";
import { recordStockMovement } from "@/lib/stock";

describe("fixes from the QA review", () => {
  let organizationId: string;
  let conversationId: string;

  beforeAll(async () => {
    organizationId = (await prisma.organization.create({ data: { name: "QA Fixes Org" } })).id;
    await prisma.user.create({
      data: { memberships: { create: { organizationId, role: "OWNER" } }, email: "qa-fixes@example.com", passwordHash: "x", name: "Owner" },
    });
    const customer = await prisma.customer.create({
      data: { organizationId, phone: "+15550004444", phoneKey: phoneKeyOf("+15550004444")!, name: "Chat Customer" },
    });
    conversationId = (await prisma.conversation.create({ data: { organizationId, customerId: customer.id } })).id;
    await prisma.message.create({ data: { conversationId, direction: "INBOUND", sender: "CUSTOMER", body: "hello" } });
    await prisma.product.create({ data: { organizationId, sku: "ANK-1", name: "Ankara", priceCents: 100000 } });
  });

  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({ choices: [{ message: { role: "assistant", content: "Hi there", tool_calls: undefined } }] });
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("automatic AI replies can be switched off", () => {
    it("an automatic reply is skipped, without calling the AI, when the owner turned it off", async () => {
      await prisma.organization.update({ where: { id: organizationId }, data: { aiAutoReply: false } });
      const result = await dispatchAIAssistReply({ organizationId, conversationId, auto: true });
      expect(result).toBeNull();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("the same reply still runs when staff ask for it by pressing the button", async () => {
      await prisma.organization.update({ where: { id: organizationId }, data: { aiAutoReply: false } });
      await dispatchAIAssistReply({ organizationId, conversationId }); // no `auto`: a person asked
      expect(mockCreate).toHaveBeenCalled();
    });

    it("an automatic reply runs when the switch is on (the default)", async () => {
      await prisma.organization.update({ where: { id: organizationId }, data: { aiAutoReply: true } });
      await dispatchAIAssistReply({ organizationId, conversationId, auto: true });
      expect(mockCreate).toHaveBeenCalled();
    });

    it("defaults to on for a new business", async () => {
      const fresh = await prisma.organization.create({ data: { name: "Default Setting Org" } });
      expect(fresh.aiAutoReply).toBe(true);
      expect(fresh.notifyCustomerOnShip).toBe(true);
    });
  });

  describe("ending a session on the server", () => {
    it("a revoked sign-in is refused, others are not", async () => {
      expect(await isSessionRevoked("sid-live-1")).toBe(false);
      await revokeSession("sid-ended-1", 7 * 24 * 3600);
      expect(await isSessionRevoked("sid-ended-1")).toBe(true);
      expect(await isSessionRevoked("sid-live-1")).toBe(false);
    });

    it("a token with no id is never treated as revoked", async () => {
      expect(await isSessionRevoked(undefined)).toBe(false);
      expect(await isSessionRevoked("")).toBe(false);
    });

    it("revoking twice is harmless", async () => {
      await revokeSession("sid-twice", 3600);
      await expect(revokeSession("sid-twice", 3600)).resolves.toBeUndefined();
      expect(await isSessionRevoked("sid-twice")).toBe(true);
    });

    it("removes records for sign-ins that would have expired anyway", async () => {
      await prisma.revokedSession.create({ data: { sid: "sid-old", expiresAt: new Date(Date.now() - 60_000) } });
      await revokeSession("sid-fresh", 3600); // housekeeping runs on each revocation
      expect(await prisma.revokedSession.findUnique({ where: { sid: "sid-old" } })).toBeNull();
      expect(await isSessionRevoked("sid-fresh")).toBe(true);
    });
  });

  describe("stock error wording", () => {
    it("says what is short in plain words", () => {
      expect(new InsufficientStockError(0, 3, "Lace Gown").message).toBe('Not enough stock of "Lace Gown": 0 available, 3 needed.');
      expect(new InsufficientStockError(2, 5).message).toBe("Not enough stock: 2 available, 5 needed.");
    });
  });

  describe("SKUs ignore letter case in CSV imports", () => {
    it("an upper-case SKU in the file updates the existing lower-case-matching product", async () => {
      const { rows } = await parseProductsCsv(organizationId, "sku,name,price\nank-1,Ankara Renamed,1500\nNEW-SKU,Brand New,900\n");
      expect(rows[0]).toMatchObject({ action: "update", sku: "ANK-1" }); // keeps the stored spelling
      expect(rows[1]).toMatchObject({ action: "create", sku: "NEW-SKU" });
    });

    it("the same SKU twice in one file with different case is flagged as a duplicate", async () => {
      const { rows } = await parseProductsCsv(organizationId, "sku,name,price\nDUP-1,One,100\ndup-1,Two,200\n");
      expect(rows.every((r) => r.action === "error")).toBe(true);
      expect(rows[0].errors.join(" ")).toMatch(/more than once/i);
    });
  });

  describe("the AI evaluation cleans up after itself", () => {
    it("removes the test business and all its data, and nothing else", async () => {
      const evalOrg = await prisma.organization.create({ data: { name: "AI Eval cleanup-test" } });
      const evalUser = await prisma.user.create({
        data: { email: "ai-eval-cleanup@example.com", passwordHash: "x", name: "Eval", memberships: { create: { organizationId: evalOrg.id, role: "OWNER" } } },
      });
      const cust = await prisma.customer.create({ data: { organizationId: evalOrg.id, phone: "+15550009999", phoneKey: phoneKeyOf("+15550009999")!, name: "Eval Customer" } });
      const conv = await prisma.conversation.create({ data: { organizationId: evalOrg.id, customerId: cust.id } });
      await prisma.message.create({ data: { conversationId: conv.id, direction: "INBOUND", sender: "CUSTOMER", body: "hi" } });
      const prod = await prisma.product.create({ data: { organizationId: evalOrg.id, sku: "EV-1", name: "Eval Product", priceCents: 1000 } });
      await recordStockMovement({ organizationId: evalOrg.id, productId: prod.id, quantityDelta: 5, reason: "INITIAL_STOCK" });
      await createDraftOrder({ organizationId: evalOrg.id, customerId: cust.id, conversationId: conv.id, createdById: evalUser.id, items: [{ productId: prod.id, quantity: 2 }] });

      await cleanupFixture({ organizationId: evalOrg.id, createdById: evalUser.id });

      expect(await prisma.organization.findUnique({ where: { id: evalOrg.id } })).toBeNull();
      expect(await prisma.user.findUnique({ where: { id: evalUser.id } })).toBeNull();
      // Other businesses' data is untouched.
      expect(await prisma.organization.findUnique({ where: { id: organizationId } })).not.toBeNull();
      expect(await prisma.product.count({ where: { organizationId } })).toBeGreaterThan(0);
    });
  });

  describe("the New order customer picker scales to thousands of customers", () => {
    let pickOrg: string;
    let otherOrg: string;
    let vipId: string;
    let productId: string;

    beforeAll(async () => {
      pickOrg = (await prisma.organization.create({ data: { name: "Picker Org" } })).id;
      otherOrg = (await prisma.organization.create({ data: { name: "Other Picker Org" } })).id;
      const rows = Array.from({ length: 120 }, (_, i) => {
        const phone = `+23470${String(10000 + i)}`;
        return { organizationId: pickOrg, phone, phoneKey: phoneKeyOf(phone)!, name: `Bulk Customer ${i}`, updatedAt: new Date(Date.now() - (i + 10) * 60_000) };
      });
      await prisma.customer.createMany({ data: rows });
      const vip = await prisma.customer.create({ data: { organizationId: pickOrg, phone: "+2347099999", phoneKey: phoneKeyOf("+2347099999")!, name: "Zainab Okafor", updatedAt: new Date(Date.now() - 999 * 60_000) } });
      vipId = vip.id;
      const other = phoneKeyOf("+2347088888")!;
      await prisma.customer.create({ data: { organizationId: otherOrg, phone: "+2347088888", phoneKey: other, name: "Zainab Elsewhere" } });
      productId = (await prisma.product.create({ data: { organizationId: pickOrg, sku: "PK-1", name: "Picker Product", priceCents: 500000 } })).id;
      await prisma.customerPrice.create({ data: { organizationId: pickOrg, customerId: vipId, productId, priceCents: 450000 } });
    });

    it("starts with only the 30 most recently active customers, not all 121", async () => {
      const recent = await recentCustomersForPicker(pickOrg);
      expect(recent).toHaveLength(30);
      expect(recent[0].name).toBe("Bulk Customer 0");
      expect(recent.some((c) => c.name === "Zainab Okafor")).toBe(false);
    });

    it("always includes the customer an order is being started for, even if they are not recent", async () => {
      const recent = await recentCustomersForPicker(pickOrg, vipId);
      expect(recent[0].id).toBe(vipId);
      expect(recent).toHaveLength(31);
    });

    it("finds anyone by name or phone, and returns the prices agreed with them", async () => {
      const byName = await searchCustomersForPicker(pickOrg, "zainab");
      expect(byName.map((c) => c.name)).toEqual(["Zainab Okafor"]);
      expect(byName[0].agreed).toEqual({ [productId]: 450000 });
      const byPhone = await searchCustomersForPicker(pickOrg, "99999");
      expect(byPhone.map((c) => c.id)).toEqual([vipId]);
    });

    it("never returns another business's customers", async () => {
      const found = await searchCustomersForPicker(pickOrg, "Zainab");
      expect(found.some((c) => c.name === "Zainab Elsewhere")).toBe(false);
      expect(await searchCustomersForPicker(otherOrg, "Okafor")).toEqual([]);
    });

    it("caps search results and treats an empty search as the recent list", async () => {
      expect((await searchCustomersForPicker(pickOrg, "Bulk")).length).toBe(30);
      expect(await searchCustomersForPicker(pickOrg, "   ")).toHaveLength(30);
      expect(await searchCustomersForPicker(pickOrg, "nobody-has-this-name")).toEqual([]);
    });
  });
});
