import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StockMovementReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { phoneKeyOf } from "@/lib/phone";
import { recordStockMovement } from "@/lib/stock";
import { confirmOrder, createDraftOrder, markOrderFulfilled, markOrderPaid } from "@/lib/orders";
import { decideReturn, markRefunded, requestReturn } from "@/lib/returns";
import { AssignmentError, assignWork, bulkAssignOrders } from "@/lib/assignment";
import { listNotifications, markAllRead, markRead, notify, ownerUserIds, unreadCount } from "@/lib/notifications";
import { getAttentionItems, getOutOfStockProducts } from "@/lib/operations";
import { HOUR_MS, SLA } from "@/lib/ops-config";
import { getProductDemand, getSalesReport, getStockMovementSummary, parseRange, toCsv } from "@/lib/reports";
import { transaction } from "@/lib/db";

describe("operations: assignment, notifications, attention, reports", () => {
  let organizationId: string;
  let otherOrganizationId: string;
  let owner: { id: string; role: "OWNER" | "STAFF" };
  let staff: { id: string; role: "OWNER" | "STAFF" };
  let otherStaff: { id: string; role: "OWNER" | "STAFF" };
  let n = 0;

  beforeAll(async () => {
    organizationId = (await prisma.organization.create({ data: { name: "Ops Org" } })).id;
    otherOrganizationId = (await prisma.organization.create({ data: { name: "Other Ops Org" } })).id;
    const o = await prisma.user.create({
      data: { email: "ops-owner@example.com", passwordHash: "x", name: "Owner", memberships: { create: { organizationId, role: "OWNER" } } },
    });
    const s = await prisma.user.create({
      data: { email: "ops-staff@example.com", passwordHash: "x", name: "Staff", memberships: { create: { organizationId, role: "STAFF" } } },
    });
    const os = await prisma.user.create({
      data: { email: "ops-other-staff@example.com", passwordHash: "x", name: "Outsider", memberships: { create: { organizationId: otherOrganizationId, role: "STAFF" } } },
    });
    owner = { id: o.id, role: "OWNER" };
    staff = { id: s.id, role: "STAFF" };
    otherStaff = { id: os.id, role: "STAFF" };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const phone = () => `+1222${String(1000000 + ++n)}`;
  async function customer(organizationId2 = organizationId) {
    const p = phone();
    return (await prisma.customer.create({ data: { organizationId: organizationId2, phone: p, phoneKey: phoneKeyOf(p)!, name: `Customer ${n}` } })).id;
  }
  async function product(stock: number, priceCents = 10000, organizationId2 = organizationId) {
    n += 1;
    const p = await prisma.product.create({ data: { organizationId: organizationId2, sku: `OPS-${n}`, name: `Ops Product ${n}`, priceCents } });
    if (stock > 0) await recordStockMovement({ organizationId: organizationId2, productId: p.id, quantityDelta: stock, reason: StockMovementReason.INITIAL_STOCK });
    return p.id;
  }
  async function order(status: "DRAFT" | "CONFIRMED" | "PAID" | "FULFILLED", opts: { customerId?: string; productId?: string; quantity?: number } = {}) {
    const customerId = opts.customerId ?? (await customer());
    const productId = opts.productId ?? (await product(50));
    const created = await createDraftOrder({ organizationId, customerId, createdById: owner.id, items: [{ productId, quantity: opts.quantity ?? 1 }] });
    if (status !== "DRAFT") await confirmOrder({ organizationId, orderId: created.id, actorId: owner.id, allowDuplicate: true });
    if (status === "PAID" || status === "FULFILLED") await markOrderPaid({ organizationId, orderId: created.id, actorId: owner.id });
    if (status === "FULFILLED") await markOrderFulfilled({ organizationId, orderId: created.id, actorId: owner.id });
    return prisma.order.findUniqueOrThrow({ where: { id: created.id } });
  }

  describe("assignment", () => {
    it("staff may assign work to themselves, and unassign their own, but not touch others'", async () => {
      const o = await order("PAID");
      await expect(assignWork({ organizationId, kind: "order", id: o.id, assigneeId: staff.id, actor: staff })).resolves.toMatchObject({ changed: true });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).assignedToId).toBe(staff.id);

      // Another staff member can't reassign it away from them.
      const anotherStaff = await prisma.user.create({
        data: { email: `ops-staff2-${n}@example.com`, passwordHash: "x", name: "Staff2", memberships: { create: { organizationId, role: "STAFF" } } },
      });
      await expect(
        assignWork({ organizationId, kind: "order", id: o.id, assigneeId: anotherStaff.id, actor: { id: anotherStaff.id, role: "STAFF" } })
      ).rejects.toBeInstanceOf(AssignmentError);

      // They can unassign their own.
      await expect(assignWork({ organizationId, kind: "order", id: o.id, assigneeId: null, actor: staff })).resolves.toMatchObject({ changed: true });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).assignedToId).toBeNull();
    });

    it("owner may assign to anyone, including taking it off someone else", async () => {
      const o = await order("PAID");
      await assignWork({ organizationId, kind: "order", id: o.id, assigneeId: staff.id, actor: owner });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).assignedToId).toBe(staff.id);
      await assignWork({ organizationId, kind: "order", id: o.id, assigneeId: null, actor: owner });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).assignedToId).toBeNull();
    });

    it("refuses to assign to someone outside the organization", async () => {
      const o = await order("PAID");
      await expect(assignWork({ organizationId, kind: "order", id: o.id, assigneeId: otherStaff.id, actor: owner })).rejects.toThrow(/member/);
    });

    it("refuses to assign a finished order, and a no-op assignment changes nothing", async () => {
      const o = await order("FULFILLED");
      await expect(assignWork({ organizationId, kind: "order", id: o.id, assigneeId: staff.id, actor: owner })).rejects.toThrow(/fulfilled/);
      const open = await order("PAID");
      await assignWork({ organizationId, kind: "order", id: open.id, assigneeId: staff.id, actor: owner });
      await expect(assignWork({ organizationId, kind: "order", id: open.id, assigneeId: staff.id, actor: owner })).resolves.toMatchObject({ changed: false });
    });

    it("assigns conversations and returns too, and notifies the assignee", async () => {
      const c = await prisma.customer.findUniqueOrThrow({ where: { id: await customer() } });
      const convo = await prisma.conversation.create({ data: { organizationId, customerId: c.id } });
      await assignWork({ organizationId, kind: "conversation", id: convo.id, assigneeId: staff.id, actor: owner });
      expect((await prisma.conversation.findUniqueOrThrow({ where: { id: convo.id } })).assignedToId).toBe(staff.id);

      const o = await order("FULFILLED");
      const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: o.id } });
      const ret = await requestReturn({ organizationId, orderId: o.id, actor: staff, reason: "damaged", items: [{ orderItemId: item.id, quantity: 1, condition: "DAMAGED" }] });
      await assignWork({ organizationId, kind: "return", id: ret.id, assigneeId: staff.id, actor: owner });
      expect((await prisma.orderReturn.findUniqueOrThrow({ where: { id: ret.id } })).assignedToId).toBe(staff.id);

      const notes = await listNotifications(organizationId, staff.id);
      expect(notes.some((note) => note.kind === "ASSIGNED" && note.href === `/inbox/${convo.id}`)).toBe(true);
    });

    it("cannot reach another organization's order", async () => {
      const foreignOrder = await createDraftOrder({
        organizationId: otherOrganizationId,
        customerId: await customer(otherOrganizationId),
        createdById: otherStaff.id,
        items: [{ productId: await product(10, 1000, otherOrganizationId), quantity: 1 }],
      });
      await expect(assignWork({ organizationId, kind: "order", id: foreignOrder.id, assigneeId: owner.id, actor: owner })).rejects.toThrow("Order not found.");
    });

    it("bulk: previews without changing anything, reports a mix of outcomes, then applies the same way", async () => {
      const a = await order("PAID");
      const b = await order("FULFILLED"); // can't be assigned
      const c = await order("PAID");
      await assignWork({ organizationId, kind: "order", id: c.id, assigneeId: staff.id, actor: owner }); // already assigned -> unchanged

      const preview = await bulkAssignOrders({ organizationId, orderIds: [a.id, b.id, c.id], assigneeId: staff.id, actor: owner, dryRun: true });
      const byId = Object.fromEntries(preview.map((r) => [r.orderId, r]));
      expect(byId[a.id].outcome).toBe("assigned");
      expect(byId[b.id].outcome).toBe("refused");
      expect(byId[c.id].outcome).toBe("unchanged");
      // Nothing changed yet.
      expect((await prisma.order.findUniqueOrThrow({ where: { id: a.id } })).assignedToId).toBeNull();

      const applied = await bulkAssignOrders({ organizationId, orderIds: [a.id, b.id, c.id], assigneeId: staff.id, actor: owner });
      const byId2 = Object.fromEntries(applied.map((r) => [r.orderId, r]));
      expect(byId2[a.id]).toMatchObject({ ok: true, outcome: "assigned" });
      expect(byId2[b.id]).toMatchObject({ ok: false, outcome: "refused" });
      expect(byId2[c.id]).toMatchObject({ ok: true, outcome: "unchanged" });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: a.id } })).assignedToId).toBe(staff.id);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: b.id } })).assignedToId).toBeNull(); // untouched
    });

    it("bulk unassigning is labelled 'unassigned', never 'assigned' (an empty assignee is still a real outcome)", async () => {
      const assigned = await order("PAID");
      await assignWork({ organizationId, kind: "order", id: assigned.id, assigneeId: staff.id, actor: owner });
      const alreadyBare = await order("PAID"); // nothing to unassign

      const preview = await bulkAssignOrders({ organizationId, orderIds: [assigned.id, alreadyBare.id], assigneeId: null, actor: owner, dryRun: true });
      const byId = Object.fromEntries(preview.map((r) => [r.orderId, r]));
      expect(byId[assigned.id].outcome).toBe("unassigned");
      expect(byId[alreadyBare.id].outcome).toBe("unchanged");
      expect((await prisma.order.findUniqueOrThrow({ where: { id: assigned.id } })).assignedToId).toBe(staff.id); // preview changed nothing

      const applied = await bulkAssignOrders({ organizationId, orderIds: [assigned.id, alreadyBare.id], assigneeId: null, actor: owner });
      const byId2 = Object.fromEntries(applied.map((r) => [r.orderId, r]));
      expect(byId2[assigned.id]).toMatchObject({ ok: true, outcome: "unassigned" });
      expect(byId2[alreadyBare.id]).toMatchObject({ ok: true, outcome: "unchanged" });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: assigned.id } })).assignedToId).toBeNull();
    });

    it("bulk rejects an empty selection and more than the cap", async () => {
      await expect(bulkAssignOrders({ organizationId, orderIds: [], assigneeId: staff.id, actor: owner })).rejects.toThrow(/at least one/);
      const ids = Array.from({ length: 101 }, (_, i) => `fake-${i}`);
      await expect(bulkAssignOrders({ organizationId, orderIds: ids, assigneeId: staff.id, actor: owner })).rejects.toThrow(/at most/);
    });
  });

  describe("notifications", () => {
    it("is idempotent per (user, dedupeKey) — a retried event creates no duplicate", async () => {
      await transaction(organizationId, (tx) =>
        notify(tx, { organizationId, userIds: [owner.id], kind: "TEST", title: "First", dedupeKey: "dedupe-test-1" })
      );
      await transaction(organizationId, (tx) =>
        notify(tx, { organizationId, userIds: [owner.id], kind: "TEST", title: "Second (should not duplicate)", dedupeKey: "dedupe-test-1" })
      );
      const notes = await listNotifications(organizationId, owner.id);
      expect(notes.filter((note) => note.dedupeKey === "dedupe-test-1")).toHaveLength(1);
    });

    it("unread count, listing, mark-read and mark-all-read only ever touch the caller's own notices", async () => {
      const target = await prisma.user.create({
        data: { email: `notif-${n}@example.com`, passwordHash: "x", name: "Notif Target", memberships: { create: { organizationId, role: "STAFF" } } },
      });
      await transaction(organizationId, (tx) =>
        notify(tx, { organizationId, userIds: [target.id], kind: "TEST", title: "One", dedupeKey: `notif-one-${n}` })
      );
      await transaction(organizationId, (tx) =>
        notify(tx, { organizationId, userIds: [target.id], kind: "TEST", title: "Two", dedupeKey: `notif-two-${n}` })
      );
      expect(await unreadCount(organizationId, target.id)).toBe(2);
      const all = await listNotifications(organizationId, target.id);
      expect(all).toHaveLength(2);

      const marked = await markRead(organizationId, target.id, [all[0].id]);
      expect(marked).toBe(1);
      expect(await unreadCount(organizationId, target.id)).toBe(1);

      // Someone else's notices can't be marked read by this user's call.
      const staffNote = await listNotifications(organizationId, staff.id);
      await markRead(organizationId, target.id, staffNote.map((x) => x.id));
      expect(await unreadCount(organizationId, staff.id)).toBe(staffNote.filter((x) => !x.readAt).length);

      const markedAll = await markAllRead(organizationId, target.id);
      expect(markedAll).toBe(1);
      expect(await unreadCount(organizationId, target.id)).toBe(0);
    });

    it("ownerUserIds returns only owners of this organization", async () => {
      const ids = await ownerUserIds(organizationId);
      expect(ids).toContain(owner.id);
      expect(ids).not.toContain(staff.id);
      expect(ids).not.toContain(otherStaff.id);
    });

    it("a return request notifies the owners (not the requester) and a decision notifies the requester", async () => {
      const o = await order("FULFILLED");
      const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: o.id } });
      const before = await unreadCount(organizationId, owner.id);
      const ret = await requestReturn({ organizationId, orderId: o.id, actor: staff, reason: "wrong size", items: [{ orderItemId: item.id, quantity: 1, condition: "RESELLABLE" }] });
      expect(await unreadCount(organizationId, owner.id)).toBe(before + 1);
      const ownerNotes = await listNotifications(organizationId, owner.id);
      expect(ownerNotes[0]).toMatchObject({ kind: "RETURN_REQUESTED", href: `/orders/${o.id}` });

      await decideReturn({ organizationId, returnId: ret.id, actor: owner, approve: true });
      const staffNotes = await listNotifications(organizationId, staff.id);
      expect(staffNotes.some((x) => x.kind === "RETURN_DECIDED")).toBe(true);
      // Approving also tells the (other) owners there is a refund to pay — but not this acting owner.
      const ownerNotes2 = await listNotifications(organizationId, owner.id);
      expect(ownerNotes2.filter((x) => x.kind === "REFUND_DUE")).toHaveLength(0); // owner approved it themself
    });

    it("cannot be read across organizations", async () => {
      await expect(listNotifications(otherOrganizationId, owner.id)).resolves.toEqual([]);
    });
  });

  describe("attention items", () => {
    it("flags a stale draft, overdue payment, and unshipped paid order, each with the right severity", async () => {
      const past = (hours: number) => new Date(Date.now() - hours * HOUR_MS);

      const draft = await order("DRAFT");
      await prisma.order.update({ where: { id: draft.id }, data: { createdAt: past(30) } });

      const unpaidWarn = await order("CONFIRMED");
      await prisma.order.update({ where: { id: unpaidWarn.id }, data: { confirmedAt: past(49) } });
      const unpaidCritical = await order("CONFIRMED");
      await prisma.order.update({ where: { id: unpaidCritical.id }, data: { confirmedAt: past(24 * 8) } });

      const unshipped = await order("PAID");
      await prisma.order.update({ where: { id: unshipped.id }, data: { paidAt: past(49) } });

      const { items } = await getAttentionItems(organizationId);
      const byId = Object.fromEntries(items.map((i) => [i.id, i]));
      expect(byId[draft.id]).toMatchObject({ severity: "info" });
      expect(byId[unpaidWarn.id]).toMatchObject({ severity: "warning" });
      expect(byId[unpaidCritical.id]).toMatchObject({ severity: "critical" });
      expect(byId[unshipped.id]).toMatchObject({ severity: "warning" });
      expect(byId[draft.id].reasons[0]).toMatch(/not confirmed/);
    });

    it("a record on several rules at once appears exactly once, with every reason, most severe first", async () => {
      const o = await order("CONFIRMED");
      // Payment-overdue on its own would only be a warning (49h, below the 168h critical
      // tier); past-due is always critical. The warning rule runs first internally — this
      // pins that the *final* ordering still puts the more severe reason first regardless.
      await prisma.order.update({
        where: { id: o.id },
        data: { confirmedAt: new Date(Date.now() - 49 * HOUR_MS), dueAt: new Date(Date.now() - HOUR_MS) },
      });
      const { items } = await getAttentionItems(organizationId);
      const matches = items.filter((i) => i.id === o.id);
      expect(matches).toHaveLength(1);
      expect(matches[0].severity).toBe("critical"); // past-due always critical
      expect(matches[0].reasons).toEqual([expect.stringMatching(/Past its due date/), expect.stringMatching(/Payment overdue/)]);
    });

    it("a waiting customer conversation is flagged with the right tier, and its name isn't duplicated", async () => {
      const c = await prisma.customer.findUniqueOrThrow({ where: { id: await customer() } });
      const convo = await prisma.conversation.create({ data: { organizationId, customerId: c.id, status: "AWAITING_STAFF", lastMessageAt: new Date(Date.now() - 3 * HOUR_MS) } });
      const { items } = await getAttentionItems(organizationId);
      const found = items.find((i) => i.id === convo.id);
      expect(found).toMatchObject({ kind: "conversation", severity: "warning", reference: c.name, customer: null });
    });

    it("a pending refund long unpaid is flagged, and shows the assignee if there is one", async () => {
      const o = await order("FULFILLED");
      const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: o.id } });
      const ret = await requestReturn({ organizationId, orderId: o.id, actor: staff, reason: "x", items: [{ orderItemId: item.id, quantity: 1, condition: "RESELLABLE" }] });
      await decideReturn({ organizationId, returnId: ret.id, actor: owner, approve: true });
      await prisma.orderReturn.update({ where: { id: ret.id }, data: { decidedAt: new Date(Date.now() - 24 * 11 * HOUR_MS), assignedToId: staff.id } });

      const { items } = await getAttentionItems(organizationId);
      const found = items.find((i) => i.id === ret.id);
      expect(found).toMatchObject({ kind: "return", severity: "critical", assignee: { id: staff.id } });
    });

    it("nothing recent or already resolved is flagged, and items sort most-severe/oldest first", async () => {
      const fresh = await order("PAID"); // just paid, not overdue
      const { items } = await getAttentionItems(organizationId);
      expect(items.find((i) => i.id === fresh.id)).toBeUndefined();

      for (let i = 1; i < items.length; i++) {
        const prevRank = items[i - 1].severity === "critical" ? 0 : items[i - 1].severity === "warning" ? 1 : 2;
        const rank = items[i].severity === "critical" ? 0 : items[i].severity === "warning" ? 1 : 2;
        expect(prevRank).toBeLessThanOrEqual(rank);
      }
    });

    it("says so when a rule has more overdue records than it can show, instead of silently dropping them", async () => {
      const { truncated: before } = await getAttentionItems(organizationId);
      expect(before).toBe(false);

      // One rule (stale drafts), well past its cap — a real backlog, not the usual handful.
      // These bypass createDraftOrder on purpose: the rule only reads status/createdAt/customer,
      // and 101 real draft orders (with items, stock reservations, ...) would be needlessly slow.
      const c = await customer();
      const stale = new Date(Date.now() - (SLA.draftStaleWarnHours + 1) * HOUR_MS);
      await prisma.order.createMany({
        data: Array.from({ length: 101 }, (_, i) => ({
          organizationId,
          reference: `TRUNC-${n}-${i}`,
          customerId: c,
          status: "DRAFT" as const,
          createdAt: stale,
        })),
      });

      const { items, truncated } = await getAttentionItems(organizationId);
      expect(truncated).toBe(true);
      // The cap still holds — this isn't "show everything once truncated is true".
      expect(items.length).toBeLessThan(201);
    });

    it("never crosses organizations", async () => {
      await order("DRAFT"); // in this org
      const foreignCustomer = await customer(otherOrganizationId);
      const foreignProduct = await product(10, 1000, otherOrganizationId);
      const foreignDraft = await createDraftOrder({ organizationId: otherOrganizationId, customerId: foreignCustomer, createdById: otherStaff.id, items: [{ productId: foreignProduct, quantity: 1 }] });
      await prisma.order.update({ where: { id: foreignDraft.id }, data: { createdAt: new Date(Date.now() - 30 * HOUR_MS) } });

      const { items: mine } = await getAttentionItems(organizationId);
      expect(mine.every((i) => i.id !== foreignDraft.id)).toBe(true);
      const { items: theirs } = await getAttentionItems(otherOrganizationId);
      expect(theirs.some((i) => i.id === foreignDraft.id)).toBe(true);
    });
  });

  describe("out-of-stock products", () => {
    it("flags only active products with no available stock", async () => {
      const zero = await product(0);
      const some = await product(5);
      const inactive = await product(0);
      await prisma.product.update({ where: { id: inactive }, data: { active: false } });

      const outOfStock = await getOutOfStockProducts(organizationId);
      const ids = outOfStock.map((p) => p.id);
      expect(ids).toContain(zero);
      expect(ids).not.toContain(some);
      expect(ids).not.toContain(inactive);
    });

    it("a product fully reserved by a confirmed order also counts as out of stock", async () => {
      const p = await product(3);
      await order("CONFIRMED", { productId: p, quantity: 3 });
      const outOfStock = await getOutOfStockProducts(organizationId);
      expect(outOfStock.map((x) => x.id)).toContain(p);
    });
  });

  describe("reports", () => {
    it("parseRange defaults to the last 30 days and rejects malformed input", () => {
      const now = new Date("2026-06-15T12:00:00Z");
      const def = parseRange(undefined, undefined, now);
      expect(def.to).toEqual(now);
      expect(def.from.getTime()).toBe(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const explicit = parseRange("2026-01-01", "2026-01-31", now);
      expect(explicit.from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
      expect(explicit.to.toISOString()).toBe("2026-01-31T23:59:59.999Z");

      const malformed = parseRange("not-a-date", "also-not", now);
      expect(malformed.to).toEqual(now);
    });

    it("sales report separates order value, cash, refunds and receivables — never calls anything profit without cost data", async () => {
      const from = new Date(Date.now() - HOUR_MS);
      const customerId = await customer();
      const p = await product(50, 10000);
      const paid = await order("PAID", { customerId, productId: p, quantity: 2 });
      const confirmedOnly = await order("CONFIRMED", { customerId, productId: p, quantity: 1 });
      const to = new Date(Date.now() + HOUR_MS);

      const report = await getSalesReport(organizationId, { from, to });
      expect(report.orderCount).toBeGreaterThanOrEqual(2);
      expect(report.cashReceivedCents).toBeGreaterThanOrEqual(20000); // the paid order
      expect(report.receivablesCents).toBeGreaterThanOrEqual(10000); // confirmedOnly, unpaid, as-of-now
      expect(report.margin).toBeNull(); // no product in this suite has costCents set up to now
      void paid;
      void confirmedOnly;
    });

    it("margin appears only when a product has a recorded cost, and reports partial coverage honestly", async () => {
      const withCost = await product(50, 10000);
      await prisma.product.update({ where: { id: withCost }, data: { costCents: 6000 } });
      const withoutCost = await product(50, 5000);
      const customerId = await customer();
      const o1 = await createDraftOrder({ organizationId, customerId, createdById: owner.id, items: [{ productId: withCost, quantity: 2 }] });
      await confirmOrder({ organizationId, orderId: o1.id, actorId: owner.id, allowDuplicate: true });
      const o2 = await createDraftOrder({ organizationId, customerId, createdById: owner.id, items: [{ productId: withoutCost, quantity: 1 }] });
      await confirmOrder({ organizationId, orderId: o2.id, actorId: owner.id, allowDuplicate: true });

      const from = new Date(Date.now() - HOUR_MS);
      const to = new Date(Date.now() + HOUR_MS);
      const report = await getSalesReport(organizationId, { from, to });
      expect(report.margin).not.toBeNull();
      expect(report.margin!.marginCents).toBe(2 * (10000 - 6000)); // only the costed line counted
      expect(report.margin!.linesWithCost).toBeGreaterThanOrEqual(1);
      expect(report.margin!.coveragePercent).toBeGreaterThan(0);
      expect(report.margin!.coveragePercent).toBeLessThan(100); // the uncosted line pulls coverage below 100%
    });

    it("refunds reduce net cash but not order value or cash received", async () => {
      const customerId = await customer();
      const p = await product(50, 10000);
      const o = await order("FULFILLED", { customerId, productId: p, quantity: 2 });
      const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: o.id } });
      const ret = await requestReturn({ organizationId, orderId: o.id, actor: staff, reason: "x", items: [{ orderItemId: item.id, quantity: 1, condition: "RESELLABLE" }] });
      await decideReturn({ organizationId, returnId: ret.id, actor: owner, approve: true });
      await markRefunded({ organizationId, returnId: ret.id, actor: owner });

      const from = new Date(Date.now() - HOUR_MS);
      const to = new Date(Date.now() + HOUR_MS);
      const report = await getSalesReport(organizationId, { from, to });
      expect(report.refundsPaidCents).toBeGreaterThanOrEqual(10000);
      expect(report.netCashCents).toBe(report.cashReceivedCents - report.refundsPaidCents);
    });

    it("product demand and stock movement summaries are scoped to the organization and the period", async () => {
      const p = await product(50, 10000);
      const customerId = await customer();
      const o = await createDraftOrder({ organizationId, customerId, createdById: owner.id, items: [{ productId: p, quantity: 4 }] });
      await confirmOrder({ organizationId, orderId: o.id, actorId: owner.id, allowDuplicate: true });

      const from = new Date(Date.now() - HOUR_MS);
      const to = new Date(Date.now() + HOUR_MS);
      const demand = await getProductDemand(organizationId, { from, to });
      const row = demand.find((d) => d.productId === p);
      expect(row).toMatchObject({ units: 4, revenueCents: 40000 });

      const movements = await getStockMovementSummary(organizationId, { from, to });
      expect(movements.some((m) => m.reason === "SALE_RESERVED")).toBe(true);
      expect(movements.every((m) => m.movements > 0)).toBe(true);
    });

    it("toCsv neutralizes formula-injection characters without mangling ordinary data", () => {
      const csv = toCsv(["Name", "Amount"], [["=SUM(A1:A9)", 100], ["Normal Name", 200], ["+1", 300], ["-1", 400], ["@cmd", 500]]);
      const lines = csv.trim().split("\n");
      expect(lines[1]).toMatch(/^"?'=SUM/);
      expect(lines[2]).toMatch(/^Normal Name/);
      expect(lines[3]).toMatch(/^"?'\+1/);
      expect(lines[4]).toMatch(/^"?'-1/);
      expect(lines[5]).toMatch(/^"?'@cmd/);
    });

    it("reports never leak across organizations", async () => {
      const foreignCustomer = await customer(otherOrganizationId);
      const foreignProduct = await product(10, 5000, otherOrganizationId);
      const foreignOrder = await createDraftOrder({ organizationId: otherOrganizationId, customerId: foreignCustomer, createdById: otherStaff.id, items: [{ productId: foreignProduct, quantity: 1 }] });
      await confirmOrder({ organizationId: otherOrganizationId, orderId: foreignOrder.id, actorId: otherStaff.id, allowDuplicate: true });

      const from = new Date(Date.now() - HOUR_MS);
      const to = new Date(Date.now() + HOUR_MS);
      const mine = await getProductDemand(organizationId, { from, to });
      expect(mine.every((d) => d.productId !== foreignProduct)).toBe(true);
    });
  });
});
