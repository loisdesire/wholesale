import { OrderStatus, StockMovementReason, UserRole, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordStockMovementTx, sortByProductId } from "@/lib/stock";
import { recordAudit } from "@/lib/audit";
import { resolveUnitPriceCents } from "@/lib/pricing";
import { getCustomerPriceMap } from "@/lib/customers";
import { lockRow } from "@/lib/locks";
import { ReturnPermissionError, createCancellationRefundTx } from "@/lib/returns";

type TxClient = Prisma.TransactionClient;

export class OrderStateError extends Error {}

/** Confirming would probably repeat an order that already exists; a person must say it's intended. */
export class DuplicateOrderError extends OrderStateError {
  constructor(public readonly references: string[]) {
    super(
      `This looks like a repeat of ${references.join(", ")} — same customer, same items, within a day. ` +
        `Confirm anyway only if the customer really wants it twice.`
    );
  }
}

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
  notes?: string;
  /** Defaults to the customer's default address when omitted. */
  deliveryAddress?: string;
}) {
  if (params.items.length === 0) {
    throw new OrderStateError("An order needs at least one item.");
  }

  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({
      where: { id: params.customerId, organizationId: params.organizationId },
      include: { addresses: { where: { isDefault: true }, take: 1 } },
    });
    if (!customer) throw new OrderStateError("Customer not found.");
    const agreedPrices = await getCustomerPriceMap(
      params.organizationId,
      customer.id,
      params.items.map((i) => i.productId),
      tx
    );

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
        unitPriceCents: resolveUnitPriceCents(
          product.priceCents,
          product.priceTiers,
          item.quantity,
          agreedPrices.get(product.id)
        ),
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
        notes: params.notes?.trim() || null,
        deliveryAddress: params.deliveryAddress?.trim() || customer.addresses[0]?.text || null,
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

// The increment takes a row lock on the organization, so concurrent drafts get
// distinct, gap-free numbers (and a rolled-back draft gives its number back).
async function nextOrderReference(tx: TxClient, organizationId: string) {
  const { orderSeq } = await tx.organization.update({
    where: { id: organizationId },
    data: { orderSeq: { increment: 1 } },
    select: { orderSeq: true },
  });
  return `ORD-${orderSeq}`;
}

async function loadOrderForUpdate(tx: TxClient, orderId: string, organizationId: string) {
  // A real lock: without it, two simultaneous confirms/cancels/payments both
  // read the same status and both act (double reservation, double refund).
  await lockRow(tx, "Order", orderId);
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

    const agreedPrices = await getCustomerPriceMap(params.organizationId, order.customerId, [product.id], tx);
    const variant = product.variantAttributes as Record<string, string> | null;
    await tx.orderItem.create({
      data: {
        orderId: order.id,
        productId: product.id,
        variantLabel: variant ? Object.values(variant).join(" / ") : null,
        quantity: params.quantity,
        unitPriceCents: resolveUnitPriceCents(
          product.priceCents,
          product.priceTiers,
          params.quantity,
          agreedPrices.get(product.id)
        ),
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
 * Changes the quantity on a line of a still-draft order — "a quantity change
 * after quoting". The line is re-priced for the new quantity (tier breaks and
 * agreed prices apply), MOQ is re-checked, and the change is audited.
 */
export async function updateOrderItemQuantity(params: {
  organizationId: string;
  orderId: string;
  orderItemId: string;
  quantity: number;
  actorId: string;
}) {
  if (!Number.isInteger(params.quantity) || params.quantity <= 0) {
    throw new OrderStateError("Quantity must be a whole number greater than zero.");
  }
  return prisma.$transaction(async (tx) => {
    const order = await loadOrderForUpdate(tx, params.orderId, params.organizationId);
    if (order.status !== OrderStatus.DRAFT) throw new OrderStateError("Only draft orders can be changed.");
    const item = order.items.find((i) => i.id === params.orderItemId);
    if (!item) throw new OrderStateError("Item not found on this order.");
    if (params.quantity < item.product.moq) {
      throw new OrderStateError(
        `${item.product.name} has a minimum order quantity of ${item.product.moq}, but ${params.quantity} was requested.`
      );
    }

    const [tiers, agreedPrices] = await Promise.all([
      tx.priceTier.findMany({ where: { productId: item.productId } }),
      getCustomerPriceMap(params.organizationId, order.customerId, [item.productId], tx),
    ]);
    const unitPriceCents = resolveUnitPriceCents(
      item.product.priceCents,
      tiers,
      params.quantity,
      agreedPrices.get(item.productId)
    );

    await tx.orderItem.update({ where: { id: item.id }, data: { quantity: params.quantity, unitPriceCents } });
    const items = await tx.orderItem.findMany({ where: { orderId: order.id } });
    const totalCents = computeTotal(items);
    await tx.order.update({ where: { id: order.id }, data: { totalCents } });

    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Order",
        entityId: order.id,
        action: "ORDER_ITEM_QUANTITY_CHANGED",
        actorId: params.actorId,
        before: { sku: item.product.sku, quantity: item.quantity, unitPriceCents: item.unitPriceCents, totalCents: order.totalCents },
        after: { sku: item.product.sku, quantity: params.quantity, unitPriceCents, totalCents },
      },
      tx
    );
  });
}

/** Notes and delivery address can change until the order is fulfilled or cancelled. */
export async function updateOrderDetails(params: {
  organizationId: string;
  orderId: string;
  actorId: string;
  notes: string | null;
  deliveryAddress: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const order = await loadOrderForUpdate(tx, params.orderId, params.organizationId);
    if (order.status === OrderStatus.FULFILLED || order.status === OrderStatus.CANCELLED) {
      throw new OrderStateError("A fulfilled or cancelled order can no longer be changed.");
    }
    const next = {
      notes: params.notes?.trim() || null,
      deliveryAddress: params.deliveryAddress?.trim() || null,
    };
    await tx.order.update({ where: { id: order.id }, data: next });
    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Order",
        entityId: order.id,
        action: "ORDER_DETAILS_UPDATED",
        actorId: params.actorId,
        before: { notes: order.notes, deliveryAddress: order.deliveryAddress },
        after: next,
      },
      tx
    );
  });
}

const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

function itemSignature(items: { productId: string; quantity: number }[]) {
  return items
    .map((i) => `${i.productId}x${i.quantity}`)
    .sort()
    .join("|");
}

/**
 * Other live orders from the same customer, created within a day of this one,
 * with exactly the same items and quantities — the signature of a repeated
 * request (a double-tap, a customer re-sending their message). Only flags;
 * whether it's really a repeat is a human call.
 */
export async function findDuplicateOrders(
  organizationId: string,
  orderId: string,
  client: TxClient | typeof prisma = prisma
) {
  const order = await client.order.findFirst({
    where: { id: orderId, organizationId },
    include: { items: true },
  });
  if (!order || order.items.length === 0) return [];

  const candidates = await client.order.findMany({
    where: {
      organizationId,
      customerId: order.customerId,
      id: { not: order.id },
      status: { not: OrderStatus.CANCELLED },
      createdAt: {
        gte: new Date(order.createdAt.getTime() - DUPLICATE_WINDOW_MS),
        lte: new Date(order.createdAt.getTime() + DUPLICATE_WINDOW_MS),
      },
    },
    include: { items: true },
    take: 50,
  });
  const signature = itemSignature(order.items);
  return candidates.filter((c) => itemSignature(c.items) === signature).map((c) => ({ id: c.id, reference: c.reference, status: c.status }));
}

/**
 * Confirms a draft order: reserves stock for every line item atomically (all
 * items succeed or none do) and moves the order to CONFIRMED. This is the
 * point stock leaves *available* — not at draft, since a draft/quote is
 * non-binding, and not at fulfilment, since that would let two confirmed
 * orders oversell the same units between confirm and fulfil. Fulfilment later
 * moves the units out of physical + reserved (available is unaffected).
 */
export async function confirmOrder(params: {
  organizationId: string;
  orderId: string;
  actorId: string;
  /** Set when a person has seen the repeat-order warning and wants to go ahead. */
  allowDuplicate?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const order = await loadOrderForUpdate(tx, params.orderId, params.organizationId);
    if (order.status !== OrderStatus.DRAFT) {
      throw new OrderStateError("Only draft orders can be confirmed.");
    }
    if (order.items.length === 0) {
      throw new OrderStateError("Add at least one item before confirming.");
    }

    const duplicates = await findDuplicateOrders(params.organizationId, order.id, tx);
    if (duplicates.length > 0 && !params.allowDuplicate) {
      throw new DuplicateOrderError(duplicates.map((d) => d.reference));
    }

    for (const item of sortByProductId(order.items)) {
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
        after: {
          status: "CONFIRMED",
          ...(duplicates.length > 0 ? { confirmedDespiteDuplicateOf: duplicates.map((d) => d.reference) } : {}),
        },
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

    // The goods physically leave: physical and reserved both drop, available
    // is unchanged (it was already taken out of availability at confirmation).
    for (const item of sortByProductId(order.items)) {
      await recordStockMovementTx(tx, {
        organizationId: params.organizationId,
        productId: item.productId,
        quantityDelta: -item.quantity,
        reason: StockMovementReason.SALE_FULFILLED,
        reference: order.reference,
        createdById: params.actorId,
      });
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
 * Cancels an order. Draft: nothing to undo. Confirmed: releases the stock it
 * reserved. Paid (not yet fulfilled): owner-only — it also releases the stock
 * and records the refund now owed to the customer, which then follows the same
 * pay-out step as any refund. Fulfilled orders can't be cancelled; goods that
 * left come back through a return.
 */
export async function cancelOrder(params: {
  organizationId: string;
  orderId: string;
  actorId: string;
  /** Needed to cancel a paid order; leaving it out is treated as not-an-owner. */
  actorRole?: UserRole;
}) {
  return prisma.$transaction(async (tx) => {
    const order = await loadOrderForUpdate(tx, params.orderId, params.organizationId);
    const cancellable: OrderStatus[] = [OrderStatus.DRAFT, OrderStatus.CONFIRMED, OrderStatus.PAID];
    if (!cancellable.includes(order.status)) {
      throw new OrderStateError(
        order.status === OrderStatus.FULFILLED
          ? "A fulfilled order can't be cancelled — record a return instead."
          : "This order can't be cancelled."
      );
    }
    if (order.status === OrderStatus.PAID && params.actorRole !== UserRole.OWNER) {
      throw new ReturnPermissionError("Only an owner can cancel a paid order, because it means refunding the customer.");
    }

    if (order.status !== OrderStatus.DRAFT) {
      for (const item of sortByProductId(order.items)) {
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

    let refundReference: string | undefined;
    if (order.status === OrderStatus.PAID) {
      const refund = await createCancellationRefundTx(tx, {
        organizationId: params.organizationId,
        order,
        actor: { id: params.actorId, role: UserRole.OWNER },
      });
      refundReference = refund.reference;
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
        after: { status: "CANCELLED", ...(refundReference ? { refundOwed: refundReference, refundCents: order.totalCents } : {}) },
      },
      tx
    );

    return updated;
  });
}
