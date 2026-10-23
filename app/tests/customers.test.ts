import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StockMovementReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { displayPhone, phoneKeyOf, phonesLookRelated } from "@/lib/phone";
import {
  CustomerError,
  DuplicateCustomerError,
  addCustomerAddress,
  createCustomer,
  findPossibleDuplicates,
  removeCustomerAddress,
  removeCustomerPrice,
  setCustomerPrice,
  setDefaultAddress,
  updateCustomer,
} from "@/lib/customers";
import { ingestInboundMessage } from "@/lib/inbox";
import { addOrderItem, createDraftOrder, updateOrderItemQuantity, confirmOrder } from "@/lib/orders";
import { recordStockMovement } from "@/lib/stock";

describe("phone identity", () => {
  it("reduces every common way of writing one Nigerian number to the same key", () => {
    for (const written of [
      "+2348031234567",
      "2348031234567",
      "08031234567",
      "0803 123 4567",
      "803 123 4567",
      "+234 803 123 4567",
      "+234 (0) 803 123 4567",
      "00234 803 123 4567",
      "0803-123-4567",
    ]) {
      expect(phoneKeyOf(written), written).toBe("2348031234567");
    }
  });

  it("keeps numbers from other countries as their digits and rejects non-numbers", () => {
    expect(phoneKeyOf("+44 7700 900123")).toBe("447700900123");
    expect(phoneKeyOf("+1 (415) 555-0100")).toBe("14155550100");
    expect(phoneKeyOf("")).toBeNull();
    expect(phoneKeyOf("call me")).toBeNull();
    expect(phoneKeyOf("12345")).toBeNull();
    expect(phoneKeyOf("1".repeat(16))).toBeNull();
  });

  it("formats and compares keys", () => {
    expect(displayPhone("2348031234567")).toBe("+2348031234567");
    expect(phonesLookRelated("2348031234567", "448031234567")).toBe(true);
    expect(phonesLookRelated("2348031234567", "2348031234567")).toBe(false);
    expect(phonesLookRelated("2348031234567", "2348039999999")).toBe(false);
  });
});

describe("customer records", () => {
  let organizationId: string;
  let otherOrganizationId: string;
  let owner: { id: string };
  let staffId: string;
  let n = 0;
  const phone = () => `+23480${String(30000000 + ++n * 17).padStart(8, "0")}`;

  beforeAll(async () => {
    organizationId = (await prisma.organization.create({ data: { name: "Customers Org" } })).id;
    otherOrganizationId = (await prisma.organization.create({ data: { name: "Other Customers Org" } })).id;
    owner = await prisma.user.create({
      data: { organizationId, email: "cust-owner@example.com", passwordHash: "x", name: "Owner", role: "OWNER" },
    });
    staffId = (
      await prisma.user.create({
        data: { organizationId, email: "cust-staff@example.com", passwordHash: "x", name: "Staff", role: "STAFF" },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const create = (overrides: Partial<Parameters<typeof createCustomer>[0]> = {}) =>
    createCustomer({ organizationId, phone: phone(), actorId: owner.id, ...overrides });

  describe("creating", () => {
    it("normalizes the stored phone and audits the creation", async () => {
      const customer = await create({ phone: "0803 555 0001", name: "  Amaka  ", email: " AMAKA@Example.com " });
      expect(customer).toMatchObject({ phone: "+2348035550001", phoneKey: "2348035550001", name: "Amaka", email: "amaka@example.com" });
      const audit = await prisma.auditLog.findMany({ where: { entityId: customer.id } });
      expect(audit.map((a) => a.action)).toEqual(["CUSTOMER_CREATED"]);
    });

    it("refuses a number we already have, however it is written, and points at the existing record", async () => {
      const first = await create({ phone: "+2348035550002", name: "First" });
      for (const written of ["08035550002", "0803 555 0002", "2348035550002", "+234 (0) 803 555 0002"]) {
        const error = await create({ phone: written, name: "Someone else" }).catch((e) => e);
        expect(error, written).toBeInstanceOf(DuplicateCustomerError);
        expect((error as DuplicateCustomerError).existingId).toBe(first.id);
      }
      expect(await prisma.customer.count({ where: { organizationId, phoneKey: "2348035550002" } })).toBe(1);
      // The original is untouched.
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: first.id } })).name).toBe("First");
    });

    it("lets two organizations each have a customer with the same number", async () => {
      const number = "+2348035550003";
      await create({ phone: number });
      await createCustomer({ organizationId: otherOrganizationId, phone: number });
      expect(await prisma.customer.count({ where: { phoneKey: "2348035550003" } })).toBe(2);
    });

    it("rejects numbers that aren't numbers", async () => {
      await expect(create({ phone: "not a number" })).rejects.toBeInstanceOf(CustomerError);
      await expect(create({ phone: "123" })).rejects.toThrow(/valid phone number/);
    });

    it("six simultaneous creates of one number produce exactly one customer", async () => {
      const number = "08035550004";
      const results = await Promise.allSettled(Array.from({ length: 6 }, () => create({ phone: number })));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results.filter((r) => r.status === "rejected")) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(DuplicateCustomerError);
      }
      expect(await prisma.customer.count({ where: { organizationId, phoneKey: "2348035550004" } })).toBe(1);
    });
  });

  describe("WhatsApp ingestion matches on the normalized number", () => {
    const message = (from: string, externalId: string) => ({
      externalId,
      from,
      contactName: "WhatsApp Name",
      timestamp: new Date(),
      body: "Hello",
    });

    it("attaches a webhook message to the customer staff entered in another format", async () => {
      const staffEntered = await create({ phone: "0803 555 0005", name: "Entered By Staff" });
      await ingestInboundMessage(organizationId, message("2348035550005", "wamid.id-1")); // Meta sends no "+"

      expect(await prisma.customer.count({ where: { organizationId, phoneKey: "2348035550005" } })).toBe(1);
      const conversations = await prisma.conversation.findMany({ where: { customerId: staffEntered.id } });
      expect(conversations).toHaveLength(1);
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: staffEntered.id } })).name).toBe("Entered By Staff");
    });

    it("simultaneous first messages from a brand-new number create one customer, not two", async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, (_, i) => ingestInboundMessage(organizationId, message("2348035550006", `wamid.race-${i}`)))
      );
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
      expect(await prisma.customer.count({ where: { organizationId, phoneKey: "2348035550006" } })).toBe(1);
      const customer = await prisma.customer.findFirstOrThrow({ where: { organizationId, phoneKey: "2348035550006" } });
      expect(await prisma.message.count({ where: { conversation: { customerId: customer.id } } })).toBe(5);
    });
  });

  describe("editing", () => {
    it("records what changed, and validates the email", async () => {
      const customer = await create({ name: "Before", notes: "old" });
      await updateCustomer({
        organizationId,
        customerId: customer.id,
        actorId: staffId,
        name: "After",
        email: "after@example.com",
        notes: "",
      });
      const stored = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
      expect(stored).toMatchObject({ name: "After", email: "after@example.com", notes: null });

      const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityId: customer.id, action: "CUSTOMER_UPDATED" } });
      expect(entry.before).toMatchObject({ name: "Before", notes: "old" });
      expect(entry.after).toMatchObject({ name: "After", email: "after@example.com" });
      expect(entry.actorId).toBe(staffId);

      await expect(
        updateCustomer({ organizationId, customerId: customer.id, actorId: staffId, name: "x", email: "nope", notes: null })
      ).rejects.toThrow(/email/);
    });

    it("cannot reach a customer in another organization", async () => {
      const customer = await create();
      await expect(
        updateCustomer({ organizationId: otherOrganizationId, customerId: customer.id, actorId: staffId, name: "Hijack", email: null, notes: null })
      ).rejects.toThrow("Customer not found.");
      await expect(
        addCustomerAddress({ organizationId: otherOrganizationId, customerId: customer.id, actorId: staffId, text: "x" })
      ).rejects.toThrow("Customer not found.");
    });
  });

  describe("addresses", () => {
    it("makes the first address the default, and keeps exactly one default", async () => {
      const customer = await create();
      const args = { organizationId, customerId: customer.id, actorId: staffId };
      const a = await addCustomerAddress({ ...args, label: "Shop", text: "12 Market Rd, Enugu" });
      const b = await addCustomerAddress({ ...args, text: "5 Home St, Lagos" });
      expect([a.isDefault, b.isDefault]).toEqual([true, false]);

      await setDefaultAddress({ ...args, addressId: b.id });
      const rows = await prisma.customerAddress.findMany({ where: { customerId: customer.id } });
      expect(rows.filter((r) => r.isDefault).map((r) => r.id)).toEqual([b.id]);
    });

    it("promotes another address when the default is removed", async () => {
      const customer = await create();
      const args = { organizationId, customerId: customer.id, actorId: staffId };
      const a = await addCustomerAddress({ ...args, text: "A" });
      const b = await addCustomerAddress({ ...args, text: "B" });
      await removeCustomerAddress({ ...args, addressId: a.id });
      expect((await prisma.customerAddress.findUniqueOrThrow({ where: { id: b.id } })).isDefault).toBe(true);
    });

    it("rejects an empty address and another customer's address id", async () => {
      const one = await create();
      const two = await create();
      await expect(addCustomerAddress({ organizationId, customerId: one.id, actorId: staffId, text: "  " })).rejects.toThrow(/address/);
      const theirs = await addCustomerAddress({ organizationId, customerId: two.id, actorId: staffId, text: "Theirs" });
      await expect(
        removeCustomerAddress({ organizationId, customerId: one.id, addressId: theirs.id, actorId: staffId })
      ).rejects.toThrow("Address not found.");
      await expect(
        setDefaultAddress({ organizationId, customerId: one.id, addressId: theirs.id, actorId: staffId })
      ).rejects.toThrow("Address not found.");
      expect(await prisma.customerAddress.count({ where: { id: theirs.id } })).toBe(1);
    });
  });

  describe("agreed prices", () => {
    let productId: string;
    let staff: { id: string; role: "OWNER" | "STAFF" };
    let boss: { id: string; role: "OWNER" | "STAFF" };

    beforeAll(async () => {
      staff = { id: staffId, role: "STAFF" };
      boss = { id: owner.id, role: "OWNER" };
      const product = await prisma.product.create({
        data: {
          organizationId,
          sku: "AGREED-1",
          name: "Agreed Price Product",
          priceCents: 10000,
          priceTiers: { create: [{ minQuantity: 10, priceCents: 8000 }] },
        },
      });
      productId = product.id;
      await recordStockMovement({ organizationId, productId, quantityDelta: 500, reason: StockMovementReason.INITIAL_STOCK });
    });

    const setPrice = (customerId: string, priceCents: number, actor = boss) =>
      setCustomerPrice({ organizationId, customerId, productId, priceCents, actorId: actor.id, actorRole: actor.role });

    const draft = (customerId: string, quantity: number) =>
      createDraftOrder({ organizationId, customerId, createdById: owner.id, items: [{ productId, quantity }] });

    it("only an owner can set or remove one", async () => {
      const customer = await create();
      await expect(setPrice(customer.id, 5000, staff)).rejects.toThrow(/Only an owner/);
      await setPrice(customer.id, 5000);
      await expect(
        removeCustomerPrice({ organizationId, customerId: customer.id, productId, actorId: staff.id, actorRole: "STAFF" })
      ).rejects.toThrow(/Only an owner/);
      expect(await prisma.customerPrice.count({ where: { customerId: customer.id } })).toBe(1);
    });

    it("beats both the list price and quantity breaks on new orders, for that customer only", async () => {
      const vip = await create();
      const regular = await create();
      await setPrice(vip.id, 9500); // dearer than the 10+ tier on purpose: an agreement is an agreement

      expect((await draft(vip.id, 1)).totalCents).toBe(9500);
      expect((await draft(vip.id, 20)).totalCents).toBe(20 * 9500); // not the 8,000 tier
      expect((await draft(regular.id, 1)).totalCents).toBe(10000);
      expect((await draft(regular.id, 20)).totalCents).toBe(20 * 8000);
    });

    it("applies when items are added or re-quantified on a draft", async () => {
      const customer = await create();
      await setPrice(customer.id, 7000);
      const order = await draft(customer.id, 2);
      await addOrderItem({ organizationId, orderId: order.id, productId, quantity: 3 });
      const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
      expect(items.map((i) => i.unitPriceCents)).toEqual([7000, 7000]);

      await updateOrderItemQuantity({
        organizationId,
        orderId: order.id,
        orderItemId: items[0].id,
        quantity: 50,
        actorId: owner.id,
      });
      expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: items[0].id } })).unitPriceCents).toBe(7000);
    });

    it("never changes an order that already exists when the agreement changes or is removed", async () => {
      const customer = await create();
      await setPrice(customer.id, 6000);
      const order = await draft(customer.id, 4);
      await confirmOrder({ organizationId, orderId: order.id, actorId: owner.id });

      await setPrice(customer.id, 1000);
      await removeCustomerPrice({ organizationId, customerId: customer.id, productId, actorId: owner.id, actorRole: "OWNER" });

      const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
      expect(item.unitPriceCents).toBe(6000);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).totalCents).toBe(24000);
      // And new orders are back to the normal price.
      expect((await draft(customer.id, 1)).totalCents).toBe(10000);
    });

    it("audits each change, with before and after", async () => {
      const customer = await create();
      await setPrice(customer.id, 6000);
      await setPrice(customer.id, 5500);
      await removeCustomerPrice({ organizationId, customerId: customer.id, productId, actorId: owner.id, actorRole: "OWNER" });
      const log = await prisma.auditLog.findMany({
        where: { entityId: customer.id, action: { in: ["CUSTOM_PRICE_SET", "CUSTOM_PRICE_REMOVED"] } },
        orderBy: { createdAt: "asc" },
      });
      expect(log.map((l) => l.action)).toEqual(["CUSTOM_PRICE_SET", "CUSTOM_PRICE_SET", "CUSTOM_PRICE_REMOVED"]);
      expect(log[1].before).toMatchObject({ priceCents: 6000 });
      expect(log[1].after).toMatchObject({ priceCents: 5500 });
    });

    it("rejects non-positive prices, unknown products and other organizations' products", async () => {
      const customer = await create();
      await expect(setPrice(customer.id, 0)).rejects.toThrow(/greater than zero/);
      await expect(setPrice(customer.id, -5)).rejects.toThrow(/greater than zero/);
      await expect(
        setCustomerPrice({ organizationId, customerId: customer.id, productId: "nope", priceCents: 100, actorId: owner.id, actorRole: "OWNER" })
      ).rejects.toThrow("Product not found.");
      const foreign = await prisma.product.create({
        data: { organizationId: otherOrganizationId, sku: "FOREIGN-1", name: "Foreign", priceCents: 100 },
      });
      await expect(
        setCustomerPrice({ organizationId, customerId: customer.id, productId: foreign.id, priceCents: 100, actorId: owner.id, actorRole: "OWNER" })
      ).rejects.toThrow("Product not found.");
    });
  });

  describe("orders and customers", () => {
    it("won't create an order for a customer in another organization", async () => {
      const foreign = await createCustomer({ organizationId: otherOrganizationId, phone: phone() });
      const product = await prisma.product.create({ data: { organizationId, sku: `X-${++n}`, name: "P", priceCents: 100 } });
      await expect(
        createDraftOrder({ organizationId, customerId: foreign.id, createdById: owner.id, items: [{ productId: product.id, quantity: 1 }] })
      ).rejects.toThrow("Customer not found.");
    });

    it("prefills the delivery address from the customer's default, unless one is given", async () => {
      const customer = await create();
      await addCustomerAddress({ organizationId, customerId: customer.id, actorId: owner.id, text: "Default Address, Enugu" });
      const product = await prisma.product.create({ data: { organizationId, sku: `X-${++n}`, name: "P", priceCents: 100 } });
      const items = [{ productId: product.id, quantity: 1 }];

      const prefilled = await createDraftOrder({ organizationId, customerId: customer.id, createdById: owner.id, items });
      expect(prefilled.deliveryAddress).toBe("Default Address, Enugu");

      const explicit = await createDraftOrder({
        organizationId,
        customerId: customer.id,
        createdById: owner.id,
        items,
        deliveryAddress: "  One-off Address  ",
        notes: "Call on arrival",
      });
      expect(explicit).toMatchObject({ deliveryAddress: "One-off Address", notes: "Call on arrival" });
    });
  });

  describe("possible duplicates", () => {
    it("flags a number that differs only by country code or formatting, and the same email", async () => {
      const a = await create({ phone: "+2348035551001", email: "twin@example.com", name: "Alpha" });
      const sameLine = await create({ phone: "+448035551001", name: "Beta" }); // same last 9 digits
      const sameEmail = await create({ email: "TWIN@example.com", name: "Gamma" });
      const stranger = await create({ name: "Delta" });

      const found = await findPossibleDuplicates(organizationId, a.id);
      const byId = new Map(found.map((f) => [f.customer.id, f.reasons]));
      expect(byId.get(sameLine.id)?.join(" ")).toMatch(/Phone number matches/);
      expect(byId.get(sameEmail.id)?.join(" ")).toMatch(/Same email/);
      expect(byId.has(stranger.id)).toBe(false);
    });

    it("treats a shared name as a weak signal on its own", async () => {
      const a = await create({ name: "Ngozi Okeke" });
      const b = await create({ name: "ngozi okeke" });
      const found = await findPossibleDuplicates(organizationId, a.id);
      expect(found.find((f) => f.customer.id === b.id)?.reasons).toEqual(["Same name (weak signal — could be different people)"]);
    });

    it("only reports; it never merges or changes anything", async () => {
      const a = await create({ phone: "+2348035552001", name: "Twin" });
      const b = await create({ phone: "+448035552001", name: "Twin" });
      await findPossibleDuplicates(organizationId, a.id);
      expect(await prisma.customer.count({ where: { id: { in: [a.id, b.id] } } })).toBe(2);
    });

    it("doesn't look across organizations", async () => {
      const mine = await create({ phone: "+2348035553001", name: "Cross Org" });
      await createCustomer({ organizationId: otherOrganizationId, phone: "+2348035553001", name: "Cross Org" });
      expect(await findPossibleDuplicates(organizationId, mine.id)).toEqual([]);
    });
  });
});
