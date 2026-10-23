import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StockMovementReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { phoneKeyOf } from "@/lib/phone";
import { recordStockMovement } from "@/lib/stock";
import {
  CustomerError,
  DuplicateCustomerError,
  addCustomerAddress,
  createCustomer,
  findPossibleDuplicates,
  setCustomerPrice,
  updateCustomer,
} from "@/lib/customers";
import { mergeCustomers, previewMerge, undoMerge } from "@/lib/customer-merge";
import { confirmOrder, createDraftOrder, markOrderPaid, markOrderFulfilled } from "@/lib/orders";
import { requestReturn } from "@/lib/returns";
import { getCustomerBalances } from "@/lib/balances";
import { ingestInboundMessage } from "@/lib/inbox";
import { searchEverything } from "@/lib/search";

describe("customer merge", () => {
  let organizationId: string;
  let otherOrganizationId: string;
  let owner: { id: string; role: "OWNER" | "STAFF" };
  let staff: { id: string; role: "OWNER" | "STAFF" };
  let productId: string;
  let productB: string;
  let n = 0;

  beforeAll(async () => {
    organizationId = (await prisma.organization.create({ data: { name: "Merge Org" } })).id;
    otherOrganizationId = (await prisma.organization.create({ data: { name: "Other Merge Org" } })).id;
    const o = await prisma.user.create({
      data: { organizationId, email: "merge-owner@example.com", passwordHash: "x", name: "Owner", role: "OWNER" },
    });
    const s = await prisma.user.create({
      data: { organizationId, email: "merge-staff@example.com", passwordHash: "x", name: "Staff", role: "STAFF" },
    });
    owner = { id: o.id, role: "OWNER" };
    staff = { id: s.id, role: "STAFF" };
    productId = (await prisma.product.create({ data: { organizationId, sku: "MRG-1", name: "Merge Product", priceCents: 10000 } })).id;
    productB = (await prisma.product.create({ data: { organizationId, sku: "MRG-2", name: "Merge Product B", priceCents: 20000 } })).id;
    for (const id of [productId, productB]) {
      await recordStockMovement({ organizationId, productId: id, quantityDelta: 10000, reason: StockMovementReason.INITIAL_STOCK });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const phone = () => `+23480${String(55000000 + ++n * 13).padStart(8, "0")}`;
  const make = (overrides: Partial<Parameters<typeof createCustomer>[0]> = {}) =>
    createCustomer({ organizationId, phone: phone(), actorId: owner.id, ...overrides });
  const merge = (sourceId: string, targetId: string, actor = owner, note?: string) =>
    mergeCustomers({ organizationId, sourceId, targetId, actor, note });

  async function orderFor(customerId: string, quantity = 1, productIdArg = productId) {
    return createDraftOrder({ organizationId, customerId, createdById: owner.id, items: [{ productId: productIdArg, quantity }] });
  }

  describe("permissions and validation", () => {
    it("is owner-only for preview, merge and undo", async () => {
      const a = await make();
      const b = await make();
      await expect(previewMerge(organizationId, a.id, b.id, staff)).rejects.toThrow(/Only an owner/);
      await expect(merge(a.id, b.id, staff)).rejects.toThrow(/Only an owner/);
      const done = await merge(a.id, b.id);
      await expect(undoMerge({ organizationId, mergeId: done.merge.id, actor: staff })).rejects.toThrow(/Only an owner/);
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: a.id } })).mergedIntoId).toBe(b.id);
    });

    it("refuses a customer into itself, unknown customers, and other organizations' customers", async () => {
      const a = await make();
      const foreign = await createCustomer({ organizationId: otherOrganizationId, phone: phone() });
      await expect(merge(a.id, a.id)).rejects.toThrow(/two different customers/);
      await expect(merge(a.id, "nope")).rejects.toThrow("Customer not found.");
      await expect(merge(a.id, foreign.id)).rejects.toThrow("Customer not found.");
      await expect(merge(foreign.id, a.id)).rejects.toThrow("Customer not found.");
    });

    it("refuses to merge a record that is already merged, or into one that is", async () => {
      const a = await make();
      const b = await make();
      const c = await make();
      await merge(a.id, b.id);
      await expect(merge(a.id, c.id)).rejects.toThrow(/already been merged/);
      await expect(merge(c.id, a.id)).rejects.toThrow(/has itself been merged/);
    });
  });

  describe("preview", () => {
    it("reports exactly what would move and changes nothing", async () => {
      const a = await make({ name: "Ada", notes: "Source note" });
      const b = await make({ name: "Ada Obi" });
      await orderFor(a.id);
      await orderFor(a.id, 2);
      await addCustomerAddress({ organizationId, customerId: a.id, actorId: owner.id, text: "1 Same Street" });
      await addCustomerAddress({ organizationId, customerId: b.id, actorId: owner.id, text: "  1  SAME street " });
      await addCustomerAddress({ organizationId, customerId: a.id, actorId: owner.id, text: "9 Unique Road" });

      const plan = await previewMerge(organizationId, a.id, b.id, owner);
      expect(plan.orders).toHaveLength(2);
      expect(plan.addressesToMove.map((x) => x.text)).toEqual(["9 Unique Road"]);
      expect(plan.addressesAlreadyOnTarget).toHaveLength(1);
      expect(plan.fieldChanges).toEqual({ notesAppended: true });
      expect(plan.warnings.join(" ")).toMatch(/names differ/);

      // Nothing changed.
      expect(await prisma.order.count({ where: { customerId: a.id } })).toBe(2);
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: a.id } })).mergedIntoId).toBeNull();
      expect(await prisma.customerMerge.count({ where: { sourceId: a.id } })).toBe(0);
    });
  });

  describe("merging", () => {
    it("moves conversations, orders, returns, addresses and prices, and archives the source", async () => {
      const source = await make({ name: "Source Person", email: "src@example.com", notes: "Likes bulk" });
      const target = await make({ name: null, email: null, notes: "Target note" });

      await ingestInboundMessage(organizationId, {
        externalId: `wamid.m-${n}`, from: source.phoneKey, contactName: "S", timestamp: new Date(), body: "Hello",
      });
      const order = await orderFor(source.id, 3);
      await addCustomerAddress({ organizationId, customerId: source.id, actorId: owner.id, label: "Shop", text: "Source Shop Address" });
      await addCustomerAddress({ organizationId, customerId: target.id, actorId: owner.id, text: "Target Default Address" });
      await setCustomerPrice({ organizationId, customerId: source.id, productId, priceCents: 7000, actorId: owner.id, actorRole: "OWNER" });

      const { moved, merge: record } = await merge(source.id, target.id, owner, "Same person, two numbers");
      expect(moved).toEqual({ conversations: 1, orders: 1, returns: 0, addresses: 1, agreedPrices: 1 });
      expect(record.note).toBe("Same person, two numbers");

      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).customerId).toBe(target.id);
      expect(await prisma.conversation.count({ where: { customerId: target.id } })).toBe(1);
      expect(await prisma.conversation.count({ where: { customerId: source.id } })).toBe(0);
      expect(await prisma.customerPrice.count({ where: { customerId: target.id, productId } })).toBe(1);

      // The kept customer's own default address stays the default; the moved one is not.
      const addresses = await prisma.customerAddress.findMany({ where: { customerId: target.id } });
      expect(addresses.filter((x) => x.isDefault).map((x) => x.text)).toEqual(["Target Default Address"]);
      expect(addresses).toHaveLength(2);

      const stored = await prisma.customer.findUniqueOrThrow({ where: { id: target.id } });
      expect(stored.name).toBe("Source Person"); // blank name filled
      expect(stored.email).toBe("src@example.com");
      expect(stored.notes).toBe(`Target note\n\n[Merged from Source Person (${source.phone})] Likes bulk`);

      const archived = await prisma.customer.findUniqueOrThrow({ where: { id: source.id } });
      expect(archived.mergedIntoId).toBe(target.id);
      expect(archived.mergedAt).not.toBeNull();
    });

    it("never overwrites the kept customer's own name, email or notes", async () => {
      const source = await make({ name: "Other Name", email: "other@example.com", notes: null });
      const target = await make({ name: "Kept Name", email: "kept@example.com", notes: "Kept" });
      await merge(source.id, target.id);
      expect(await prisma.customer.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({
        name: "Kept Name",
        email: "kept@example.com",
        notes: "Kept",
      });
    });

    it("on a price conflict the kept customer's price wins and the other stays on the archived record", async () => {
      const source = await make();
      const target = await make();
      const setPrice = (customerId: string, pid: string, priceCents: number) =>
        setCustomerPrice({ organizationId, customerId, productId: pid, priceCents, actorId: owner.id, actorRole: "OWNER" });
      await setPrice(source.id, productId, 5000); // conflicts
      await setPrice(target.id, productId, 6000);
      await setPrice(source.id, productB, 15000); // no conflict

      const { moved, plan } = await merge(source.id, target.id);
      expect(moved.agreedPrices).toBe(1);
      expect(plan.priceConflicts).toEqual([{ productId, sku: "MRG-1", sourcePriceCents: 5000, targetPriceCents: 6000 }]);
      const targetPrices = await prisma.customerPrice.findMany({ where: { customerId: target.id } });
      expect(Object.fromEntries(targetPrices.map((p) => [p.productId, p.priceCents]))).toEqual({ [productId]: 6000, [productB]: 15000 });
      expect(await prisma.customerPrice.count({ where: { customerId: source.id, productId } })).toBe(1);
    });

    it("the balance follows the orders and refunds", async () => {
      const source = await make();
      const target = await make();
      const unpaid = await orderFor(source.id, 2);
      await confirmOrder({ organizationId, orderId: unpaid.id, actorId: owner.id, allowDuplicate: true });
      const shipped = await orderFor(source.id, 5, productB);
      await confirmOrder({ organizationId, orderId: shipped.id, actorId: owner.id, allowDuplicate: true });
      await markOrderPaid({ organizationId, orderId: shipped.id, actorId: owner.id });
      await markOrderFulfilled({ organizationId, orderId: shipped.id, actorId: owner.id });
      await requestReturn({
        organizationId,
        orderId: shipped.id,
        actor: staff,
        reason: "faulty",
        items: [{ orderItemId: (await prisma.orderItem.findFirstOrThrow({ where: { orderId: shipped.id } })).id, quantity: 1, condition: "RESELLABLE" }],
      });
      await orderFor(target.id, 1);

      await merge(source.id, target.id);
      const balances = await getCustomerBalances(organizationId, [source.id, target.id]);
      expect(balances.get(source.id)).toBeUndefined();
      expect(balances.get(target.id)).toMatchObject({ outstandingCents: 20000, paidCents: 100000, refundRequestedCents: 20000 });
      expect(await prisma.orderReturn.count({ where: { customerId: target.id } })).toBe(1);
    });

    it("writes an audit entry on both records", async () => {
      const source = await make();
      const target = await make();
      await orderFor(source.id);
      const { merge: record } = await merge(source.id, target.id);
      const sourceLog = await prisma.auditLog.findFirstOrThrow({ where: { entityId: source.id, action: "CUSTOMER_MERGED_INTO" } });
      const targetLog = await prisma.auditLog.findFirstOrThrow({ where: { entityId: target.id, action: "CUSTOMER_MERGED_FROM" } });
      expect(sourceLog.after).toMatchObject({ mergedInto: target.id, mergeId: record.id, orders: 1 });
      expect(targetLog.after).toMatchObject({ mergedFrom: source.id, mergeId: record.id, sourcePhone: source.phone });
    });
  });

  describe("after a merge", () => {
    it("a message from the merged-away number lands on the surviving customer", async () => {
      const source = await make({ phone: "+2348056600001" });
      const target = await make({ phone: "+2348056600002" });
      await merge(source.id, target.id);

      await ingestInboundMessage(organizationId, {
        externalId: "wamid.after-merge-1", from: "2348056600001", contactName: "S", timestamp: new Date(), body: "Hi again",
      });
      expect(await prisma.conversation.count({ where: { customerId: source.id } })).toBe(0);
      expect(await prisma.conversation.count({ where: { customerId: target.id } })).toBe(1);
      expect(await prisma.customer.count({ where: { organizationId, phoneKey: "2348056600001" } })).toBe(1); // no new customer either
    });

    it("follows a chain: A merged into B, B merged into C", async () => {
      const a = await make({ phone: "+2348056600011" });
      const b = await make();
      const c = await make();
      await merge(a.id, b.id);
      await merge(b.id, c.id);
      await ingestInboundMessage(organizationId, {
        externalId: "wamid.chain-1", from: "2348056600011", contactName: undefined, timestamp: new Date(), body: "Hello",
      });
      expect(await prisma.conversation.count({ where: { customerId: c.id } })).toBeGreaterThanOrEqual(1);
      expect(await prisma.conversation.count({ where: { customerId: a.id } })).toBe(0);
    });

    it("creating a customer with a merged number points at the survivor", async () => {
      const source = await make({ phone: "+2348056600021" });
      const target = await make({ name: "Survivor" });
      await merge(source.id, target.id);
      const error = await createCustomer({ organizationId, phone: "08056600021" }).catch((e) => e);
      expect(error).toBeInstanceOf(DuplicateCustomerError);
      expect(error.existingId).toBe(target.id);
    });

    it("merged records disappear from search and from duplicate suggestions", async () => {
      const source = await make({ name: "Hidden Hannah" });
      const target = await make({ name: "Hidden Hannah" });
      const other = await make({ name: "Hidden Hannah" });
      expect((await searchEverything(organizationId, "Hidden Hannah")).customers).toHaveLength(3);
      await merge(source.id, target.id);
      const found = (await searchEverything(organizationId, "Hidden Hannah")).customers.map((c) => c.id);
      expect(found.sort()).toEqual([target.id, other.id].sort());
      expect((await findPossibleDuplicates(organizationId, other.id)).map((d) => d.customer.id)).toEqual([target.id]);
    });
  });

  describe("undo", () => {
    it("puts everything back and un-hides the original", async () => {
      const source = await make({ name: "Source", notes: "Src notes" });
      const target = await make({ name: "Target", notes: "Tgt notes" });
      const order = await orderFor(source.id);
      await addCustomerAddress({ organizationId, customerId: source.id, actorId: owner.id, text: "Source Address" });
      await setCustomerPrice({ organizationId, customerId: source.id, productId, priceCents: 4000, actorId: owner.id, actorRole: "OWNER" });
      await ingestInboundMessage(organizationId, { externalId: `wamid.undo-${n}`, from: source.phoneKey, contactName: undefined, timestamp: new Date(), body: "x" });

      const { merge: record } = await merge(source.id, target.id);
      const { restored, fieldsLeftAsEdited } = await undoMerge({ organizationId, mergeId: record.id, actor: owner });

      expect(restored).toEqual({ conversations: 1, orders: 1, returns: 0, addresses: 1, agreedPrices: 1 });
      expect(fieldsLeftAsEdited).toEqual([]);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).customerId).toBe(source.id);
      expect(await prisma.customerPrice.count({ where: { customerId: source.id } })).toBe(1);
      expect(await prisma.customerAddress.count({ where: { customerId: source.id } })).toBe(1);
      expect(await prisma.conversation.count({ where: { customerId: source.id } })).toBe(1);
      expect(await prisma.customer.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ name: "Target", notes: "Tgt notes" });
      expect(await prisma.customer.findUniqueOrThrow({ where: { id: source.id } })).toMatchObject({ mergedIntoId: null, mergedAt: null });
      expect((await prisma.customerMerge.findUniqueOrThrow({ where: { id: record.id } })).undoneAt).not.toBeNull();
    });

    it("leaves things created for the surviving customer after the merge with them", async () => {
      const source = await make();
      const target = await make();
      await orderFor(source.id);
      const { merge: record } = await merge(source.id, target.id);
      const later = await orderFor(target.id, 4); // placed after the merge

      await undoMerge({ organizationId, mergeId: record.id, actor: owner });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: later.id } })).customerId).toBe(target.id);
      expect(await prisma.order.count({ where: { customerId: source.id } })).toBe(1);
    });

    it("restores name/email/notes only when nobody edited them since", async () => {
      const source = await make({ name: "Src", email: "s@example.com", notes: "Src notes" });
      const target = await make({ name: null, email: null, notes: "Tgt" });
      const { merge: record } = await merge(source.id, target.id);
      await updateCustomer({ organizationId, customerId: target.id, actorId: owner.id, name: "Edited After Merge", email: "s@example.com", notes: null });

      const { fieldsLeftAsEdited } = await undoMerge({ organizationId, mergeId: record.id, actor: owner });
      expect(fieldsLeftAsEdited.sort()).toEqual(["name", "notes"]);
      const stored = await prisma.customer.findUniqueOrThrow({ where: { id: target.id } });
      expect(stored.name).toBe("Edited After Merge"); // the edit survived
      expect(stored.email).toBeNull(); // unedited → restored to before
    });

    it("can only be undone once, and not after the survivor was merged elsewhere", async () => {
      const a = await make();
      const b = await make();
      const c = await make();
      const first = await merge(a.id, b.id);
      await merge(b.id, c.id);
      await expect(undoMerge({ organizationId, mergeId: first.merge.id, actor: owner })).rejects.toThrow(/since been merged into another record/);

      const d = await make();
      const e = await make();
      const second = await merge(d.id, e.id);
      await undoMerge({ organizationId, mergeId: second.merge.id, actor: owner });
      await expect(undoMerge({ organizationId, mergeId: second.merge.id, actor: owner })).rejects.toThrow(/already been undone/);
    });

    it("an undone pair can be merged again, and messages route back to the original after undo", async () => {
      const source = await make({ phone: "+2348056600031" });
      const target = await make();
      const first = await merge(source.id, target.id);
      await undoMerge({ organizationId, mergeId: first.merge.id, actor: owner });

      await ingestInboundMessage(organizationId, { externalId: "wamid.post-undo", from: "2348056600031", contactName: undefined, timestamp: new Date(), body: "hi" });
      expect(await prisma.conversation.count({ where: { customerId: source.id } })).toBe(1);

      await expect(merge(source.id, target.id)).resolves.toBeDefined();
    });

    it("cannot reach another organization's merge", async () => {
      const a = await make();
      const b = await make();
      const done = await merge(a.id, b.id);
      await expect(undoMerge({ organizationId: otherOrganizationId, mergeId: done.merge.id, actor: owner })).rejects.toThrow("Merge not found.");
    });
  });

  describe("simultaneous merges", () => {
    it("merging one record into two different customers at once: exactly one wins", async () => {
      const source = await make();
      const x = await make();
      const y = await make();
      const results = await Promise.allSettled([merge(source.id, x.id), merge(source.id, y.id), merge(source.id, x.id)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results.filter((r) => r.status === "rejected")) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(CustomerError);
      }
      expect(await prisma.customerMerge.count({ where: { sourceId: source.id } })).toBe(1);
    });

    it("A into B racing B into A can't create a cycle", async () => {
      const a = await make();
      const b = await make();
      const results = await Promise.allSettled([merge(a.id, b.id), merge(b.id, a.id)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const [ca, cb] = await Promise.all([
        prisma.customer.findUniqueOrThrow({ where: { id: a.id } }),
        prisma.customer.findUniqueOrThrow({ where: { id: b.id } }),
      ]);
      expect([ca.mergedIntoId, cb.mergedIntoId].filter(Boolean)).toHaveLength(1);
    });
  });

  it("a merged customer's phone key can't be reused for a different person", async () => {
    const source = await make({ phone: "+2348056600041" });
    const target = await make();
    await merge(source.id, target.id);
    await expect(createCustomer({ organizationId, phone: "2348056600041" })).rejects.toBeInstanceOf(DuplicateCustomerError);
    expect(phoneKeyOf(source.phone)).toBe(source.phoneKey);
  });
});
