import {
  ReturnKind,
  OrderStatus,
  RefundStatus,
  ReturnItemCondition,
  ReturnStatus,
  StockMovementReason,
  UserRole,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { recordStockMovementTx, sortByProductId } from "@/lib/stock";
import { lockRow } from "@/lib/locks";

type TxClient = Prisma.TransactionClient;

export class ReturnStateError extends Error {}
export class ReturnPermissionError extends Error {}

type Actor = { id: string; role: UserRole };

// Deciding on a return and paying a refund out are the human-approval steps
// VISION.md requires for refunds, so only an owner may take them. Staff can
// raise a return and record the goods coming back.
function requireOwner(actor: Actor, what: string) {
  if (actor.role !== UserRole.OWNER) {
    throw new ReturnPermissionError(`Only an owner can ${what}.`);
  }
}

// Returns that still count against what the customer can send back. A rejected
// return frees its quantity up again.
const COUNTING_STATUSES = [ReturnStatus.REQUESTED, ReturnStatus.APPROVED, ReturnStatus.RECEIVED];

/** How many units of each order line can still be returned. */
export async function getReturnableQuantities(orderId: string, client: TxClient | typeof prisma = prisma) {
  const [items, returned] = await Promise.all([
    client.orderItem.findMany({ where: { orderId }, select: { id: true, quantity: true } }),
    client.returnItem.groupBy({
      by: ["orderItemId"],
      where: { return: { orderId, status: { in: COUNTING_STATUSES } } },
      _sum: { quantity: true },
    }),
  ]);
  const returnedByItem = new Map(returned.map((r) => [r.orderItemId, r._sum.quantity ?? 0]));
  return new Map(items.map((i) => [i.id, i.quantity - (returnedByItem.get(i.id) ?? 0)]));
}

/**
 * Raises a return against a fulfilled order. The refund amount is fixed here
 * from the order lines' locked prices. Nothing happens to stock or money yet —
 * those wait for the owner's decision and the goods arriving.
 */
export async function requestReturn(params: {
  organizationId: string;
  orderId: string;
  actor: Actor;
  reason: string;
  items: { orderItemId: string; quantity: number; condition: ReturnItemCondition }[];
}) {
  const reason = params.reason.trim();
  if (!reason) throw new ReturnStateError("Say why the goods are being returned.");
  if (params.items.length === 0) throw new ReturnStateError("Choose at least one item to return.");

  const requested = new Map<string, { quantity: number; condition: ReturnItemCondition }>();
  for (const item of params.items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new ReturnStateError("Return quantities must be whole numbers greater than zero.");
    }
    if (requested.has(item.orderItemId)) {
      throw new ReturnStateError("Each order line can only appear once in a return.");
    }
    requested.set(item.orderItemId, item);
  }

  return prisma.$transaction(async (tx) => {
    await lockRow(tx, "Order", params.orderId);
    const order = await tx.order.findFirst({
      where: { id: params.orderId, organizationId: params.organizationId },
      include: { items: true },
    });
    if (!order) throw new ReturnStateError("Order not found.");
    if (order.status !== OrderStatus.FULFILLED) {
      throw new ReturnStateError("Returns can only be raised against fulfilled orders.");
    }

    const returnable = await getReturnableQuantities(order.id, tx);
    let refundCents = 0;
    for (const [orderItemId, item] of requested) {
      const line = order.items.find((i) => i.id === orderItemId);
      if (!line) throw new ReturnStateError("One of the selected items is not on this order.");
      const left = returnable.get(orderItemId) ?? 0;
      if (item.quantity > left) {
        throw new ReturnStateError(
          left === 0
            ? "That item has already been returned in full."
            : `Only ${left} of that item can still be returned.`
        );
      }
      refundCents += item.quantity * line.unitPriceCents;
    }

    const { returnSeq } = await tx.organization.update({
      where: { id: params.organizationId },
      data: { returnSeq: { increment: 1 } },
      select: { returnSeq: true },
    });

    const created = await tx.orderReturn.create({
      data: {
        organizationId: params.organizationId,
        reference: `RET-${returnSeq}`,
        orderId: order.id,
        customerId: order.customerId,
        reason,
        refundCents,
        requestedById: params.actor.id,
        items: {
          create: [...requested].map(([orderItemId, item]) => ({
            orderItemId,
            quantity: item.quantity,
            condition: item.condition,
          })),
        },
      },
      include: { items: true },
    });

    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Order",
        entityId: order.id,
        action: "RETURN_REQUESTED",
        actorId: params.actor.id,
        after: { return: created.reference, refundCents, reason },
      },
      tx
    );
    return created;
  });
}

async function loadReturn(tx: TxClient, organizationId: string, returnId: string) {
  await lockRow(tx, "OrderReturn", returnId);
  const ret = await tx.orderReturn.findFirst({
    where: { id: returnId, organizationId },
    include: { items: { include: { orderItem: true } } },
  });
  if (!ret) throw new ReturnStateError("Return not found.");
  return ret;
}

/** Owner approves or rejects a requested return. Approving makes the refund payable. */
export async function decideReturn(params: {
  organizationId: string;
  returnId: string;
  actor: Actor;
  approve: boolean;
  note?: string;
}) {
  requireOwner(params.actor, "approve or reject a return");

  return prisma.$transaction(async (tx) => {
    const ret = await loadReturn(tx, params.organizationId, params.returnId);
    if (ret.status !== ReturnStatus.REQUESTED) {
      throw new ReturnStateError("This return has already been decided.");
    }

    const updated = await tx.orderReturn.update({
      where: { id: ret.id },
      data: {
        status: params.approve ? ReturnStatus.APPROVED : ReturnStatus.REJECTED,
        refundStatus: params.approve ? RefundStatus.PENDING : RefundStatus.NONE,
        decidedById: params.actor.id,
        decidedAt: new Date(),
        decisionNote: params.note?.trim() || null,
      },
    });

    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Order",
        entityId: ret.orderId,
        action: params.approve ? "RETURN_APPROVED" : "RETURN_REJECTED",
        actorId: params.actor.id,
        before: { return: ret.reference, status: ret.status },
        after: { return: ret.reference, status: updated.status, refundCents: params.approve ? ret.refundCents : 0 },
      },
      tx
    );
    return updated;
  });
}

/**
 * Records the goods physically coming back: resellable units go back into
 * available stock, damaged ones go on hand but into the damaged figure.
 */
export async function receiveReturn(params: { organizationId: string; returnId: string; actor: Actor }) {
  return prisma.$transaction(async (tx) => {
    const ret = await loadReturn(tx, params.organizationId, params.returnId);
    if (ret.status !== ReturnStatus.APPROVED) {
      throw new ReturnStateError(
        ret.status === ReturnStatus.RECEIVED
          ? "These goods have already been received."
          : "Only an approved return can be received."
      );
    }

    const movements = sortByProductId(
      ret.items.map((item) => ({
        productId: item.orderItem.productId,
        quantity: item.quantity,
        condition: item.condition,
      }))
    );
    for (const m of movements) {
      await recordStockMovementTx(tx, {
        organizationId: params.organizationId,
        productId: m.productId,
        quantityDelta: m.quantity,
        reason:
          m.condition === ReturnItemCondition.RESELLABLE
            ? StockMovementReason.RETURN
            : StockMovementReason.RETURN_DAMAGED,
        reference: ret.reference,
        createdById: params.actor.id,
      });
    }

    const updated = await tx.orderReturn.update({
      where: { id: ret.id },
      data: { status: ReturnStatus.RECEIVED, receivedAt: new Date() },
    });

    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Order",
        entityId: ret.orderId,
        action: "RETURN_RECEIVED",
        actorId: params.actor.id,
        before: { return: ret.reference, status: ret.status },
        after: { return: ret.reference, status: "RECEIVED" },
      },
      tx
    );
    return updated;
  });
}

/** Owner records that the refund has been paid out to the customer. */
export async function markRefunded(params: {
  organizationId: string;
  returnId: string;
  actor: Actor;
  note?: string;
}) {
  requireOwner(params.actor, "record a refund");

  return prisma.$transaction(async (tx) => {
    const ret = await loadReturn(tx, params.organizationId, params.returnId);
    if (ret.refundStatus === RefundStatus.REFUNDED) {
      throw new ReturnStateError("This refund has already been recorded.");
    }
    if (ret.refundStatus !== RefundStatus.PENDING) {
      throw new ReturnStateError("Only an approved return has a refund to pay.");
    }

    const updated = await tx.orderReturn.update({
      where: { id: ret.id },
      data: { refundStatus: RefundStatus.REFUNDED, refundedAt: new Date(), refundNote: params.note?.trim() || null },
    });

    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Order",
        entityId: ret.orderId,
        action: "REFUND_PAID",
        actorId: params.actor.id,
        before: { return: ret.reference, refundStatus: "PENDING" },
        after: { return: ret.reference, refundStatus: "REFUNDED", refundCents: ret.refundCents },
      },
      tx
    );
    return updated;
  });
}

/**
 * Called inside the transaction that cancels an already-paid order: records the
 * refund the customer is now owed. Nothing ships back (the goods never left),
 * so the record is born RECEIVED to keep the "goods received" step — which would
 * restock — out of reach. The owner who cancelled has made the decision.
 */
export async function createCancellationRefundTx(
  tx: TxClient,
  params: {
    organizationId: string;
    order: { id: string; customerId: string; totalCents: number; items: { id: string; quantity: number }[] };
    actor: Actor;
  }
) {
  const { returnSeq } = await tx.organization.update({
    where: { id: params.organizationId },
    data: { returnSeq: { increment: 1 } },
    select: { returnSeq: true },
  });
  const now = new Date();
  return tx.orderReturn.create({
    data: {
      organizationId: params.organizationId,
      reference: `RET-${returnSeq}`,
      orderId: params.order.id,
      customerId: params.order.customerId,
      kind: ReturnKind.CANCELLATION,
      status: ReturnStatus.RECEIVED,
      reason: "Order cancelled after payment",
      refundCents: params.order.totalCents,
      refundStatus: RefundStatus.PENDING,
      requestedById: params.actor.id,
      decidedById: params.actor.id,
      decidedAt: now,
      items: {
        create: params.order.items.map((item) => ({
          orderItemId: item.id,
          quantity: item.quantity,
          condition: ReturnItemCondition.RESELLABLE,
        })),
      },
    },
  });
}
