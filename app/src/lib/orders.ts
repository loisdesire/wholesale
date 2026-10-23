import { OrderStatus, StockMovementReason, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordStockMovementTx } from "@/lib/stock";
import { recordAudit } from "@/lib/audit";
import { resolveUnitPriceCents } from "@/lib/pricing";

type TxClient = Prisma.TransactionClient;

export class OrderStateError extends Error {}

function computeTotal(items: { quantity: number; unitPriceCents: number }[]) {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
}

/**
 * Creates a draft order. Item prices are locked to the product's current
 * price at this moment (OrderItem.unitPriceCents) — a later catalogue price
 * change never retroactively changes what's on this order.
 */
export async function createDraftOrder(params: {
  organizationId: string;
  customerId: string;
  conversationId?: string;
  createdById: string;
  items: { productId: string; quantity: number }[];
}) {
  if (params.items.length === 0) {
    throw new OrderStateError("An order needs at least one item.");
  }

  return prisma.$transaction(async (tx) => {
    const products = await tx.product.findMany({
      where: { id: { in: params.items.map((i) => i.productId) }, organizationId: params.organizationId },
      include: { priceTiers: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    const itemsData = params.items.map((item) => {
      const product = productMap.get(item.productId);
      if (!product) throw new OrderStateError("One of the selected products could not be found.");
      if (item.quantity <= 0) throw new OrderStateError("Item quantity must be greater than zero.");
      if (item.quantity < product.moq) {
        throw new OrderStateError(
          `${product.name} has a minimum order quantity of ${product.moq}, but ${item.quantity} was requested.`
        );
      }
      const variant = product.variantAttributes as Record<string, string> | null;
      return {
        productId: product.id,
        variantLabel: variant ? Object.values(variant).join(" / ") : null,
        quantity: item.quantity,
        unitPriceCents: resolveUnitPriceCents(product.priceCents, product.priceTiers, item.quantity),
      };
    });

    const reference = await nextOrderReference(tx, params.organizationId);

    const order = await tx.order.create({
      data: {
        organizationId: params.organizationId,
        reference,
        customerId: params.customerId,
        conversationId: params.conversationId,
        status: OrderStatus.DRAFT,
        totalCents: computeTotal(itemsData),
        currency: "NGN",
        createdById: params.createdById,
        items: { create: itemsData },
      },
      include: { items: true },
    });

    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Order",
        entityId: order.id,
        action: "ORDER_DRAFTED",
        actorId: params.createdById,
        after: { status: "DRAFT", itemCount: itemsData.length, totalCents: order.totalCents },
      },
      tx
    );

    return order;
  });
}

// Count-based numbering is fine at Phase 1's manual, low-volume order rate,
// and the @@unique constraint on (organizationId, reference) means a
// collision fails loudly rather than silently duplicating a reference. A
// dedicated sequence would be needed before this sees real concurrent load.
async function nextOrderReference(tx: TxClient, organizationId: string) {
  const count = await tx.order.count({ where: { organizationId } });
  return `ORD-${1000 + count + 1}`;
}

async function loadOrderForUpdate(tx: TxClient, orderId: string, organizationId: string) {
  const order = await tx.order.findFirst({
    where: { id: orderId, organizationId },
    include: { items: { include: { product: true } } },
  });
  if (!order) throw new OrderStateError("Order not found.");
  return order;
}

/** Adds an item to a still-draft order, pricing it at the product's current price. */
export async function addOrderItem(params: {
  organizationId: string;
  orderId: string;
  productId: string;
  quantity: number;
}) {
  if (params.quantity <= 0) throw new OrderStateError("Quantity must be greater than zero.");

  return prisma.$transaction(async (tx) => {
    const order = await loadOrderForUpdate(tx, params.orderId, params.organizationId);
    if (order.status !== OrderStatus.DRAFT) {
      throw new OrderStateError("Only draft orders can be changed.");
    }
    const product = await tx.product.findFirst({
      where: { id: params.productId, organizationId: params.organizationId },
      include: { priceTiers: true },
    });
    if (!product) throw new OrderStateError("Product not found.");
    if (params.quantity < product.moq) {
      throw new OrderStateError(
        `${product.name} has a minimum order quantity of ${product.moq}, but ${params.quantity} was requested.`
      );
    }

    const variant = product.variantAttributes as Record<string, string> | null;
    await tx.orderItem.create({
      data: {
        orderId: order.id,
        productId: product.id,
        variantLabel: variant ? Object.values(variant).join(" / ") : null,
        quantity: params.quantity,
        unitPriceCents: resolveUnitPriceCents(product.priceCents, product.priceTiers, params.quantity),
      },
    });

    const items = await tx.orderItem.findMany({ where: { orderId: order.id } });
    await tx.order.update({ where: { id: order.id }, data: { totalCents: computeTotal(items) } });
  });
}

/** Removes an item from a still-draft order. */
export async function removeOrderItem(params: {
  organizationId: string;
  orderId: string;
  orderItemId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const order = await loadOrderForUpdate(tx, params.orderId, params.organizationId);
    if (order.status !== OrderStatus.DRAFT) {
      throw new OrderStateError("Only draft orders can be changed.");
    }
    const item = order.items.find((i) => i.id === params.orderItemId);
    if (!item) throw new OrderStateError("Item not found on this order.");

    await tx.orderItem.delete({ where: { id: params.orderItemId } });

    const remaining = await tx.orderItem.findMany({ where: { orderId: order.id } });
    await tx.order.update({ where: { id: order.id }, data: { totalCents: computeTotal(remaining) } });
  });
}

/**
 * Confirms a draft order: reserves stock for every line item atomically (all
 * items succeed or none do) and moves the order to CONFIRMED. This is the
 * point stock actually leaves the available ledger — not at draft, since a
 * draft/quote is non-binding, and not at fulfilment, since that would let
 * two confirmed orders oversell the same units between confirm and fulfil.
 */
export async function confirmOrder(params: { organizationId: string; orderId: string; actorId: string }) {
  return prisma.$transaction(async (tx) => {
    const order = await loadOrderForUpdate(tx, params.orderId, params.organizationId);
    if (order.status !== OrderStatus.DRAFT) {
      throw new OrderStateError("Only draft orders can be confirmed.");
    }
    if (order.items.length === 0) {
      throw new OrderStateError("Add at least one item before confirming.");
    }

    for (const item of order.items) {
      await recordStockMovementTx(tx, {
        organizationId: params.organizationId,
        productId: item.productId,
        quantityDelta: -item.quantity,
        reason: StockMovementReason.SALE_RESERVED,
        reference: order.reference,
        createdById: params.actorId,
      });
    }

    const updated = await tx.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.CONFIRMED, confirmedAt: new Date() },
    });

    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Order",
        entityId: order.id,
        action: "ORDER_CONFIRMED",
        actorId: params.actorId,
        before: { status: "DRAFT" },
        after: { status: "CONFIRMED" },
      },
      tx
    );

    return updated;
  });
}

export async function markOrderPaid(params: { organizationId: string; orderId: string; actorId: string }) {
  return prisma.$transaction(async (tx) => {
    const order = await loadOrderForUpdate(tx, params.orderId, params.organizationId);
    if (order.status !== OrderStatus.CONFIRMED) {
      throw new OrderStateError("Only confirmed orders can be marked as paid.");
    }

    const updated = await tx.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.PAID, paidAt: new Date() },
    });

    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Order",
        entityId: order.id,
        action: "PAYMENT_MARKED_PAID",
        actorId: params.actorId,
        before: { status: "CONFIRMED" },
        after: { status: "PAID" },
      },
      tx
    );

    return updated;
  });
}

export async function markOrderFulfilled(params: { organizationId: string; orderId: string; actorId: string }) {
  return prisma.$transaction(async (tx) => {
    const order = await loadOrderForUpdate(tx, params.orderId, params.organizationId);
    if (order.status !== OrderStatus.PAID) {
      throw new OrderStateError("Only paid orders can be marked as fulfilled.");
    }

    const updated = await tx.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.FULFILLED, fulfilledAt: new Date() },
    });

    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Order",
        entityId: order.id,
        action: "ORDER_FULFILLED",
        actorId: params.actorId,
        before: { status: "PAID" },
        after: { status: "FULFILLED" },
      },
      tx
    );

    return updated;
  });
}

/**
 * Cancels a draft or confirmed order. A confirmed order already reserved
 * stock at confirm time, so cancelling it releases that reservation back to
 * the available ledger. Once PAID, cancellation is out of Phase 1 scope
 * (that's a refund workflow, not a plain cancel) — only FULFILLED progress
 * is allowed from there.
 */
export async function cancelOrder(params: { organizationId: string; orderId: string; actorId: string }) {
  return prisma.$transaction(async (tx) => {
    const order = await loadOrderForUpdate(tx, params.orderId, params.organizationId);
    if (order.status !== OrderStatus.DRAFT && order.status !== OrderStatus.CONFIRMED) {
      throw new OrderStateError("Only draft or confirmed orders can be cancelled.");
    }

    if (order.status === OrderStatus.CONFIRMED) {
      for (const item of order.items) {
        await recordStockMovementTx(tx, {
          organizationId: params.organizationId,
          productId: item.productId,
          quantityDelta: item.quantity,
          reason: StockMovementReason.RESERVATION_RELEASED,
          reference: order.reference,
          createdById: params.actorId,
        });
      }
    }

    const updated = await tx.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.CANCELLED, cancelledAt: new Date() },
    });

    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Order",
        entityId: order.id,
        action: "ORDER_CANCELLED",
        actorId: params.actorId,
        before: { status: order.status },
        after: { status: "CANCELLED" },
      },
      tx
    );

    return updated;
  });
}
