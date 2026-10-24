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
import { transaction, type DbClient } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { recordStockMovementTx, sortByProductId } from "@/lib/stock";
import { lockRow } from "@/lib/locks";
import { notify, ownerUserIds } from "@/lib/notifications";
import { createPaystackRefund } from "@/lib/payments";

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
// return frees its quantity up again. Only RETURN-kind records count: cancellation
// and unshipped refunds are about goods that never left, so they use no returnable units.
const COUNTING_STATUSES = [ReturnStatus.REQUESTED, ReturnStatus.APPROVED, ReturnStatus.RECEIVED];

/**
 * How many units of each order line can still be returned: what has actually
 * shipped, minus what is already being returned. (Ordered-but-unshipped units
 * can't come back — they never left.)
 */
export async function getReturnableQuantities(orderId: string, client: DbClient) {
  const [items, shipped, returned] = await Promise.all([
    client.orderItem.findMany({ where: { orderId }, select: { id: true } }),
    client.shipmentItem.groupBy({
      by: ["orderItemId"],
      where: { shipment: { orderId } },
      _sum: { quantity: true },
    }),
    client.returnItem.groupBy({
      by: ["orderItemId"],
      where: { return: { orderId, kind: ReturnKind.RETURN, status: { in: COUNTING_STATUSES } } },
      _sum: { quantity: true },
    }),
  ]);
  const shippedByItem = new Map(shipped.map((r) => [r.orderItemId, r._sum.quantity ?? 0]));
  const returnedByItem = new Map(returned.map((r) => [r.orderItemId, r._sum.quantity ?? 0]));
  return new Map(items.map((i) => [i.id, (shippedByItem.get(i.id) ?? 0) - (returnedByItem.get(i.id) ?? 0)]));
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

  return transaction(params.organizationId, async (tx) => {
    await lockRow(tx, "Order", params.orderId);
    const order = await tx.order.findFirst({
      where: { id: params.orderId, organizationId: params.organizationId },
      include: { items: true },
    });
    if (!order) throw new ReturnStateError("Order not found.");
    if (order.status !== OrderStatus.FULFILLED && order.status !== OrderStatus.PARTIALLY_FULFILLED) {
      throw new ReturnStateError("Returns can only be raised against orders that have shipped.");
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
            ? "Nothing of that item is left to return (it has either not shipped or is already returned)."
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
        valueCents: refundCents,
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
    // The owners decide on returns, so they are the ones to tell.
    await notify(tx, {
      organizationId: params.organizationId,
      userIds: (await ownerUserIds(params.organizationId)).filter((id) => id !== params.actor.id),
      kind: "RETURN_REQUESTED",
      title: `Return ${created.reference} needs a decision`,
      body: reason,
      href: `/orders/${order.id}`,
      dedupeKey: `return-requested:${created.id}`,
    });
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
  /**
   * Approve paying back less than the goods' value (a restocking fee, damage,
   * goodwill…). Must be positive and at most the value; a reason is required
   * when it is less.
   */
  refundCents?: number;
}) {
  requireOwner(params.actor, "approve or reject a return");

  return transaction(params.organizationId, async (tx) => {
    const ret = await loadReturn(tx, params.organizationId, params.returnId);
    if (ret.status !== ReturnStatus.REQUESTED) {
      throw new ReturnStateError("This return has already been decided.");
    }

    let refundCents = ret.valueCents;
    if (params.approve && params.refundCents !== undefined && params.refundCents !== ret.valueCents) {
      if (!Number.isInteger(params.refundCents) || params.refundCents <= 0 || params.refundCents > ret.valueCents) {
        throw new ReturnStateError("A partial refund must be more than zero and no more than the value of the goods.");
      }
      if (!params.note?.trim()) throw new ReturnStateError("Say why the refund is less than the full value.");
      refundCents = params.refundCents;
    }

    const updated = await tx.orderReturn.update({
      where: { id: ret.id },
      data: {
        status: params.approve ? ReturnStatus.APPROVED : ReturnStatus.REJECTED,
        refundStatus: params.approve ? RefundStatus.PENDING : RefundStatus.NONE,
        refundCents: params.approve ? refundCents : ret.refundCents,
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
        after: {
          return: ret.reference,
          status: updated.status,
          refundCents: params.approve ? refundCents : 0,
          ...(params.approve && refundCents < ret.valueCents ? { valueCents: ret.valueCents, partial: true } : {}),
        },
      },
      tx
    );
    // Tell whoever asked for the return what was decided; if it was approved, tell the
    // owners there is a refund to pay.
    if (ret.requestedById && ret.requestedById !== params.actor.id) {
      await notify(tx, {
        organizationId: params.organizationId,
        userIds: [ret.requestedById],
        kind: "RETURN_DECIDED",
        title: `Return ${ret.reference} was ${params.approve ? "approved" : "rejected"}`,
        body: params.note?.trim() || undefined,
        href: `/orders/${ret.orderId}`,
        dedupeKey: `return-decided:${ret.id}`,
      });
    }
    if (params.approve) {
      await notify(tx, {
        organizationId: params.organizationId,
        userIds: (await ownerUserIds(params.organizationId)).filter((id) => id !== params.actor.id),
        kind: "REFUND_DUE",
        title: `Refund of ₦${(refundCents / 100).toLocaleString("en-NG")} to pay for ${ret.reference}`,
        href: `/orders/${ret.orderId}`,
        dedupeKey: `refund-due:${ret.id}`,
      });
    }
    return updated;
  });
}

/**
 * Records the goods physically coming back: resellable units go back into
 * available stock, damaged ones go on hand but into the damaged figure.
 */
export async function receiveReturn(params: { organizationId: string; returnId: string; actor: Actor }) {
  return transaction(params.organizationId, async (tx) => {
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

  return transaction(params.organizationId, async (tx) => {
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
 * Asks Paystack to refund the order's provider payment for an approved return, instead of the
 * owner recording a manual payout by hand. Mirrors the "initialize, wait for verified evidence"
 * shape of initializePayment/recordProviderPayment: Paystack's acceptance of the request is not
 * itself evidence the refund completed (see createPaystackRefund's own doc comment), so this does
 * NOT set refundStatus to REFUNDED — the owner still confirms that via markRefunded once the
 * funds are confirmed to have reached the customer. Only usable when the order has exactly one
 * Paystack payment covering at least the refund amount; anything more ambiguous (no provider
 * payment, more than one, or a refund larger than it) is refused in favour of the manual path.
 */
export async function requestProviderRefund(params: { organizationId: string; returnId: string; actor: Actor }) {
  requireOwner(params.actor, "request a Paystack refund");

  const { ret, payment } = await transaction(params.organizationId, async (tx) => {
    const ret = await loadReturn(tx, params.organizationId, params.returnId);
    if (ret.refundStatus !== RefundStatus.PENDING) {
      throw new ReturnStateError("Only an approved return has a refund to pay.");
    }

    const payments = await tx.payment.findMany({ where: { orderId: ret.orderId, method: "PROVIDER" } });
    if (payments.length === 0) {
      throw new ReturnStateError("This order wasn't paid through Paystack — record the refund as paid by hand instead.");
    }
    if (payments.length > 1) {
      throw new ReturnStateError("This order has more than one Paystack payment — record this refund as paid by hand instead.");
    }
    const payment = payments[0];
    if (ret.refundCents > payment.amountCents) {
      throw new ReturnStateError("The refund is more than the original Paystack payment — record it as paid by hand instead.");
    }
    return { ret, payment };
  });

  const result = await createPaystackRefund({
    transactionReference: payment.providerReference!,
    amountCents: ret.refundCents,
    note: `Refund for ${ret.reference}`,
  });

  await transaction(params.organizationId, (tx) =>
    recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Order",
        entityId: ret.orderId,
        action: "REFUND_REQUESTED_PROVIDER",
        actorId: params.actor.id,
        after: { return: ret.reference, refundCents: ret.refundCents, paystackStatus: result.paystackStatus },
      },
      tx
    )
  );

  return { orderId: ret.orderId, paystackStatus: result.paystackStatus };
}

/**
 * Called inside the transaction of an owner decision that leaves the customer
 * owed money for goods that never left: cancelling a paid order (CANCELLATION)
 * or closing a part-shipped order short (UNSHIPPED). The record is born
 * RECEIVED so the "goods received" step — which would restock — is out of reach,
 * and the owner who decided has made the approval.
 */
export async function createOwnerRefundTx(
  tx: TxClient,
  params: {
    organizationId: string;
    orderId: string;
    customerId: string;
    kind: "CANCELLATION" | "UNSHIPPED";
    reason: string;
    items: { orderItemId: string; quantity: number; unitPriceCents: number }[];
    actor: Actor;
  }
) {
  const valueCents = params.items.reduce((sum, i) => sum + i.quantity * i.unitPriceCents, 0);
  const { returnSeq } = await tx.organization.update({
    where: { id: params.organizationId },
    data: { returnSeq: { increment: 1 } },
    select: { returnSeq: true },
  });
  return tx.orderReturn.create({
    data: {
      organizationId: params.organizationId,
      reference: `RET-${returnSeq}`,
      orderId: params.orderId,
      customerId: params.customerId,
      kind: params.kind === "CANCELLATION" ? ReturnKind.CANCELLATION : ReturnKind.UNSHIPPED,
      status: ReturnStatus.RECEIVED,
      reason: params.reason,
      valueCents,
      refundCents: valueCents,
      refundStatus: RefundStatus.PENDING,
      requestedById: params.actor.id,
      decidedById: params.actor.id,
      decidedAt: new Date(),
      items: {
        create: params.items.map((item) => ({
          orderItemId: item.orderItemId,
          quantity: item.quantity,
          condition: ReturnItemCondition.RESELLABLE,
        })),
      },
    },
  });
}
