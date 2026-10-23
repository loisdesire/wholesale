import { Prisma, UserRole } from "@prisma/client";
import { transaction } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { lockRow } from "@/lib/locks";
import { CustomerError } from "@/lib/customers";

type TxClient = Prisma.TransactionClient;
type Actor = { id: string; role: UserRole };

const norm = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

export type MergePlan = {
  source: { id: string; name: string | null; phone: string };
  target: { id: string; name: string | null; phone: string };
  conversationIds: string[];
  orders: { id: string; reference: string }[];
  returnIds: string[];
  addressesToMove: { id: string; text: string }[];
  addressesAlreadyOnTarget: { id: string; text: string }[];
  pricesToMove: { id: string; productId: string; sku: string; priceCents: number }[];
  priceConflicts: { productId: string; sku: string; sourcePriceCents: number; targetPriceCents: number }[];
  fieldChanges: { name?: string; email?: string; notesAppended?: boolean };
  warnings: string[];
};

function requireOwner(actor: Actor, what: string) {
  if (actor.role !== UserRole.OWNER) throw new CustomerError(`Only an owner can ${what}.`);
}

async function loadPair(tx: TxClient, organizationId: string, sourceId: string, targetId: string) {
  if (sourceId === targetId) throw new CustomerError("Choose two different customers.");
  const [source, target] = await Promise.all([
    tx.customer.findFirst({ where: { id: sourceId, organizationId } }),
    tx.customer.findFirst({ where: { id: targetId, organizationId } }),
  ]);
  if (!source || !target) throw new CustomerError("Customer not found.");
  if (source.mergedIntoId) throw new CustomerError("The record to merge away has already been merged into another customer.");
  if (target.mergedIntoId) throw new CustomerError("The record to keep has itself been merged into another customer — choose the one it points to.");
  return { source, target };
}

async function computePlan(tx: TxClient, source: Customer, target: Customer): Promise<MergePlan> {
  const [conversations, orders, returns, sourceAddresses, targetAddresses, sourcePrices, targetPrices] = await Promise.all([
    tx.conversation.findMany({ where: { customerId: source.id }, select: { id: true, status: true } }),
    tx.order.findMany({ where: { customerId: source.id }, select: { id: true, reference: true, status: true } }),
    tx.orderReturn.findMany({ where: { customerId: source.id }, select: { id: true, refundStatus: true } }),
    tx.customerAddress.findMany({ where: { customerId: source.id }, orderBy: { createdAt: "asc" } }),
    tx.customerAddress.findMany({ where: { customerId: target.id } }),
    tx.customerPrice.findMany({ where: { customerId: source.id }, include: { product: true } }),
    tx.customerPrice.findMany({ where: { customerId: target.id } }),
  ]);

  const targetTexts = new Set(targetAddresses.map((a) => norm(a.text)));
  const seenSourceTexts = new Set<string>();
  const addressesToMove: MergePlan["addressesToMove"] = [];
  const addressesAlreadyOnTarget: MergePlan["addressesAlreadyOnTarget"] = [];
  for (const a of sourceAddresses) {
    const key = norm(a.text);
    if (targetTexts.has(key) || seenSourceTexts.has(key)) addressesAlreadyOnTarget.push({ id: a.id, text: a.text });
    else addressesToMove.push({ id: a.id, text: a.text });
    seenSourceTexts.add(key);
  }

  const targetPriceByProduct = new Map(targetPrices.map((p) => [p.productId, p.priceCents]));
  const pricesToMove: MergePlan["pricesToMove"] = [];
  const priceConflicts: MergePlan["priceConflicts"] = [];
  for (const p of sourcePrices) {
    const existing = targetPriceByProduct.get(p.productId);
    if (existing === undefined) pricesToMove.push({ id: p.id, productId: p.productId, sku: p.product.sku, priceCents: p.priceCents });
    else if (existing !== p.priceCents) {
      priceConflicts.push({ productId: p.productId, sku: p.product.sku, sourcePriceCents: p.priceCents, targetPriceCents: existing });
    }
  }

  const fieldChanges: MergePlan["fieldChanges"] = {};
  if (!target.name && source.name) fieldChanges.name = source.name;
  if (!target.email && source.email) fieldChanges.email = source.email;
  if (source.notes) fieldChanges.notesAppended = true;

  const warnings: string[] = [];
  if (source.name && target.name && norm(source.name) !== norm(target.name)) {
    warnings.push(`The names differ ("${source.name}" and "${target.name}") — make sure this is the same person.`);
  }
  warnings.push(
    `Different phone numbers: after merging, messages from ${source.phone} will be filed under ${target.name ?? target.phone}.`
  );
  const openConversations = conversations.filter((c) => c.status !== "RESOLVED").length;
  if (openConversations > 0) warnings.push(`${openConversations} open conversation${openConversations === 1 ? "" : "s"} will move too.`);
  const unpaid = orders.filter((o) => o.status === "CONFIRMED").length;
  if (unpaid > 0) warnings.push(`${unpaid} confirmed unpaid order${unpaid === 1 ? "" : "s"} will move — the balance follows them.`);
  const pendingRefunds = returns.filter((r) => r.refundStatus === "PENDING").length;
  if (pendingRefunds > 0) warnings.push(`${pendingRefunds} refund${pendingRefunds === 1 ? "" : "s"} still to be paid will move too.`);
  if (priceConflicts.length > 0) {
    warnings.push(
      `${priceConflicts.length} agreed price${priceConflicts.length === 1 ? "" : "s"} conflict — the kept customer's price wins and the other stays on the archived record.`
    );
  }

  return {
    source: { id: source.id, name: source.name, phone: source.phone },
    target: { id: target.id, name: target.name, phone: target.phone },
    conversationIds: conversations.map((c) => c.id),
    orders: orders.map((o) => ({ id: o.id, reference: o.reference })),
    returnIds: returns.map((r) => r.id),
    addressesToMove,
    addressesAlreadyOnTarget,
    pricesToMove,
    priceConflicts,
    fieldChanges,
    warnings,
  };
}

type Customer = Prisma.CustomerGetPayload<object>;

/** What merging `sourceId` into `targetId` would do. Changes nothing. */
export async function previewMerge(organizationId: string, sourceId: string, targetId: string, actor: Actor) {
  requireOwner(actor, "merge customers");
  return transaction(organizationId, async (tx) => {
    const { source, target } = await loadPair(tx, organizationId, sourceId, targetId);
    return computePlan(tx, source, target);
  });
}

type Snapshot = {
  conversationIds: string[];
  orderIds: string[];
  returnIds: string[];
  addressIds: string[];
  priceIds: string[];
  priceConflicts: MergePlan["priceConflicts"];
  targetBefore: { name: string | null; email: string | null; notes: string | null };
  targetAfter: { name: string | null; email: string | null; notes: string | null };
};

/**
 * Merges `sourceId` into `targetId` (the record that survives). Moves the
 * source's conversations, orders, returns, addresses and non-conflicting agreed
 * prices to the target; fills in the target's blank name/email; appends the
 * source's notes. The source isn't deleted — it's marked merged, hidden, and its
 * phone number now routes to the target — and everything that moved is recorded so
 * `undoMerge` can reverse it.
 */
export async function mergeCustomers(params: {
  organizationId: string;
  sourceId: string;
  targetId: string;
  actor: Actor;
  note?: string;
}) {
  requireOwner(params.actor, "merge customers");

  return transaction(params.organizationId, async (tx) => {
    for (const id of [params.sourceId, params.targetId].sort()) await lockRow(tx, "Customer", id);
    const { source, target } = await loadPair(tx, params.organizationId, params.sourceId, params.targetId);
    const plan = await computePlan(tx, source, target);

    await tx.conversation.updateMany({ where: { id: { in: plan.conversationIds } }, data: { customerId: target.id } });
    await tx.order.updateMany({ where: { id: { in: plan.orders.map((o) => o.id) } }, data: { customerId: target.id } });
    await tx.orderReturn.updateMany({ where: { id: { in: plan.returnIds } }, data: { customerId: target.id } });
    await tx.customerAddress.updateMany({
      where: { id: { in: plan.addressesToMove.map((a) => a.id) } },
      data: { customerId: target.id, isDefault: false }, // the kept customer's default stays the default
    });
    await tx.customerPrice.updateMany({ where: { id: { in: plan.pricesToMove.map((p) => p.id) } }, data: { customerId: target.id } });

    const targetBefore = { name: target.name, email: target.email, notes: target.notes };
    const targetAfter = {
      name: target.name ?? source.name,
      email: target.email ?? source.email,
      notes: source.notes
        ? `${target.notes ? `${target.notes}\n\n` : ""}[Merged from ${source.name ?? source.phone} (${source.phone})] ${source.notes}`
        : target.notes,
    };
    await tx.customer.update({ where: { id: target.id }, data: targetAfter });
    await tx.customer.update({ where: { id: source.id }, data: { mergedIntoId: target.id, mergedAt: new Date() } });

    const snapshot: Snapshot = {
      conversationIds: plan.conversationIds,
      orderIds: plan.orders.map((o) => o.id),
      returnIds: plan.returnIds,
      addressIds: plan.addressesToMove.map((a) => a.id),
      priceIds: plan.pricesToMove.map((p) => p.id),
      priceConflicts: plan.priceConflicts,
      targetBefore,
      targetAfter,
    };
    const merge = await tx.customerMerge.create({
      data: {
        organizationId: params.organizationId,
        sourceId: source.id,
        targetId: target.id,
        performedById: params.actor.id,
        note: params.note?.trim() || null,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    });

    const moved = {
      conversations: plan.conversationIds.length,
      orders: plan.orders.length,
      returns: plan.returnIds.length,
      addresses: plan.addressesToMove.length,
      agreedPrices: plan.pricesToMove.length,
    };
    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Customer",
        entityId: source.id,
        action: "CUSTOMER_MERGED_INTO",
        actorId: params.actor.id,
        after: { mergedInto: target.id, mergeId: merge.id, note: merge.note, ...moved },
      },
      tx
    );
    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Customer",
        entityId: target.id,
        action: "CUSTOMER_MERGED_FROM",
        actorId: params.actor.id,
        after: { mergedFrom: source.id, mergeId: merge.id, sourcePhone: source.phone, note: merge.note, ...moved },
      },
      tx
    );
    return { merge, moved, plan };
  });
}

/**
 * Reverses a merge: everything that moved comes back to the original record,
 * which is un-hidden. Things created for the surviving customer *after* the
 * merge (new orders, messages) stay with them. The target's name/email/notes are
 * restored only if nobody has edited them since.
 */
export async function undoMerge(params: { organizationId: string; mergeId: string; actor: Actor }) {
  requireOwner(params.actor, "undo a customer merge");

  return transaction(params.organizationId, async (tx) => {
    const merge = await tx.customerMerge.findFirst({ where: { id: params.mergeId, organizationId: params.organizationId } });
    if (!merge) throw new CustomerError("Merge not found.");
    for (const id of [merge.sourceId, merge.targetId].sort()) await lockRow(tx, "Customer", id);
    const fresh = await tx.customerMerge.findUniqueOrThrow({ where: { id: merge.id } });
    if (fresh.undoneAt) throw new CustomerError("This merge has already been undone.");

    const [source, target] = await Promise.all([
      tx.customer.findUniqueOrThrow({ where: { id: merge.sourceId } }),
      tx.customer.findUniqueOrThrow({ where: { id: merge.targetId } }),
    ]);
    if (source.mergedIntoId !== target.id) throw new CustomerError("That record is no longer merged into this customer.");
    if (target.mergedIntoId) {
      throw new CustomerError("The surviving customer has since been merged into another record — undo that merge first.");
    }

    const snap = merge.snapshot as unknown as Snapshot;
    const back = { customerId: target.id }; // only reclaim what is still with the target
    const [conversations, orders, returns, addresses, prices] = await Promise.all([
      tx.conversation.updateMany({ where: { id: { in: snap.conversationIds }, ...back }, data: { customerId: source.id } }),
      tx.order.updateMany({ where: { id: { in: snap.orderIds }, ...back }, data: { customerId: source.id } }),
      tx.orderReturn.updateMany({ where: { id: { in: snap.returnIds }, ...back }, data: { customerId: source.id } }),
      tx.customerAddress.updateMany({ where: { id: { in: snap.addressIds }, ...back }, data: { customerId: source.id, isDefault: false } }),
      tx.customerPrice.updateMany({ where: { id: { in: snap.priceIds }, ...back }, data: { customerId: source.id } }),
    ]);

    const restore: Prisma.CustomerUpdateInput = {};
    const kept: string[] = [];
    for (const field of ["name", "email", "notes"] as const) {
      if (target[field] === snap.targetAfter[field]) restore[field] = snap.targetBefore[field];
      else if (snap.targetAfter[field] !== snap.targetBefore[field]) kept.push(field);
    }
    if (Object.keys(restore).length > 0) await tx.customer.update({ where: { id: target.id }, data: restore });

    await tx.customer.update({ where: { id: source.id }, data: { mergedIntoId: null, mergedAt: null } });
    await tx.customerMerge.update({ where: { id: merge.id }, data: { undoneAt: new Date(), undoneById: params.actor.id } });

    const restored = {
      conversations: conversations.count,
      orders: orders.count,
      returns: returns.count,
      addresses: addresses.count,
      agreedPrices: prices.count,
    };
    for (const [entityId, role] of [[source.id, "restored"], [target.id, "unmerged"]] as const) {
      await recordAudit(
        {
          organizationId: params.organizationId,
          entity: "Customer",
          entityId,
          action: "CUSTOMER_MERGE_UNDONE",
          actorId: params.actor.id,
          after: { mergeId: merge.id, role, ...restored, ...(kept.length ? { fieldsLeftAsEdited: kept } : {}) },
        },
        tx
      );
    }
    return { restored, fieldsLeftAsEdited: kept };
  });
}
