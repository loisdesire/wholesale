import { OrderStatus, PaymentMethod, StockMovementReason, UserRole, type Prisma } from "@prisma/client";
import { transaction, type DbClient } from "@/lib/db";
import { recordStockMovementTx, sortByProductId } from "@/lib/stock";
import { recordAudit } from "@/lib/audit";
import { resolveUnitPriceCents } from "@/lib/pricing";
import { getCustomerPriceMap } from "@/lib/customers";
import { lockRow } from "@/lib/locks";
import { ReturnPermissionError, createOwnerRefundTx } from "@/lib/returns";
import { getPaidCents, writePayment } from "@/lib/payments";

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

  return transaction(params.organizationId, async (tx) => {
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

  return transaction(params.organizationId, async (tx) => {
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
  return transaction(params.organizationId, async (tx) => {
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
  return transaction(params.organizationId, async (tx) => {
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
  /** The delivery deadline. Omit to leave it as it is; null clears it. */
  dueAt?: Date | null;
}) {
  return transaction(params.organizationId, async (tx) => {
    const order = await loadOrderForUpdate(tx, params.orderId, params.organizationId);
    if (order.status === OrderStatus.FULFILLED || order.status === OrderStatus.CANCELLED) {
      throw new OrderStateError("A fulfilled or cancelled order can no longer be changed.");
    }
    if (params.dueAt instanceof Date && Number.isNaN(params.dueAt.getTime())) {
      throw new OrderStateError("That due date isn't a valid date.");
    }
    const next = {
      notes: params.notes?.trim() || null,
      deliveryAddress: params.deliveryAddress?.trim() || null,
      ...(params.dueAt !== undefined ? { dueAt: params.dueAt } : {}),
    };
    await tx.order.update({ where: { id: order.id }, data: next });
    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Order",
        entityId: order.id,
        action: "ORDER_DETAILS_UPDATED",
        actorId: params.actorId,
        before: { notes: order.notes, deliveryAddress: order.deliveryAddress, dueAt: order.dueAt },
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
  client: DbClient
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

export type OrderAmendment = {
  /** Existing lines to change; quantity 0 removes the line. */
  changes?: { orderItemId: string; quantity: number }[];
  /** Products to add (merged into an existing line for the same product). */
  additions?: { productId: string; quantity: number }[];
};

/**
 * Amends a CONFIRMED (not yet paid) order. Agreed terms are locked at
 * confirmation, so this is a deliberate exception: a reason is required, only
 * the lines that actually change are re-priced (at today's tiers/agreed prices —
 * untouched lines keep their locked price), and stock is re-reserved by the
 * difference, all-or-nothing, so an amendment that can't be covered by available
 * stock changes nothing. Once paid, the amount is settled — cancel and refund
 * instead.
 */
export async function amendConfirmedOrder(params: {
  organizationId: string;
  orderId: string;
  actorId: string;
  reason: string;
  amendment: OrderAmendment;
}) {
  const reason = params.reason.trim();
  if (!reason) throw new OrderStateError("Say why the order is being changed.");
  const changes = params.amendment.changes ?? [];
  const additions = params.amendment.additions ?? [];
  if (changes.length === 0 && additions.length === 0) throw new OrderStateError("Nothing to change.");

  return transaction(params.organizationId, async (tx) => {
    const order = await loadOrderForUpdate(tx, params.orderId, params.organizationId);
    if (order.status !== OrderStatus.CONFIRMED) {
      throw new OrderStateError(
        order.status === OrderStatus.DRAFT
          ? "A draft order can be edited directly."
          : "Only a confirmed order that hasn't been paid can be amended."
      );
    }

    // Desired quantity per existing line, then per product for added items.
    const target = new Map(order.items.map((i) => [i.id, i.quantity]));
    const touched = new Set<string>();
    const seenChanges = new Set<string>();
    for (const change of changes) {
      if (!target.has(change.orderItemId)) throw new OrderStateError("One of the lines is not on this order.");
      if (seenChanges.has(change.orderItemId)) throw new OrderStateError("Each line can only be changed once.");
      seenChanges.add(change.orderItemId);
      if (!Number.isInteger(change.quantity) || change.quantity < 0) {
        throw new OrderStateError("Quantities must be whole numbers, or 0 to remove a line.");
      }
      if (change.quantity !== target.get(change.orderItemId)) {
        target.set(change.orderItemId, change.quantity);
        touched.add(change.orderItemId);
      }
    }

    const newLines: { productId: string; quantity: number }[] = [];
    for (const add of additions) {
      if (!Number.isInteger(add.quantity) || add.quantity <= 0) {
        throw new OrderStateError("Added quantities must be whole numbers greater than zero.");
      }
      const existing = order.items.find((i) => i.productId === add.productId && (target.get(i.id) ?? 0) > 0);
      if (existing) {
        target.set(existing.id, (target.get(existing.id) ?? 0) + add.quantity);
        touched.add(existing.id);
      } else {
        const already = newLines.find((l) => l.productId === add.productId);
        if (already) already.quantity += add.quantity;
        else newLines.push({ productId: add.productId, quantity: add.quantity });
      }
    }

    const remainingLines = [...target.values()].filter((q) => q > 0).length + newLines.length;
    if (remainingLines === 0) throw new OrderStateError("An order needs at least one item — cancel the order instead.");

    const productIds = [...new Set([...order.items.map((i) => i.productId), ...newLines.map((l) => l.productId)])];
    const products = await tx.product.findMany({
      where: { id: { in: productIds }, organizationId: params.organizationId },
      include: { priceTiers: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));
    const agreedPrices = await getCustomerPriceMap(params.organizationId, order.customerId, productIds, tx);
    const priceFor = (productId: string, quantity: number) => {
      const product = productMap.get(productId)!;
      if (quantity < product.moq) {
        throw new OrderStateError(
          `${product.name} has a minimum order quantity of ${product.moq}, but ${quantity} was requested.`
        );
      }
      return resolveUnitPriceCents(product.priceCents, product.priceTiers, quantity, agreedPrices.get(productId));
    };

    const before = order.items.map((i) => ({ sku: i.product.sku, quantity: i.quantity, unitPriceCents: i.unitPriceCents }));

    // Net change per product (two lines of one product are summed).
    const delta = new Map<string, number>();
    const bump = (productId: string, d: number) => delta.set(productId, (delta.get(productId) ?? 0) + d);

    for (const item of order.items) {
      const next = target.get(item.id) ?? 0;
      if (next === item.quantity) continue;
      bump(item.productId, next - item.quantity);
      if (next === 0) {
        await tx.orderItem.delete({ where: { id: item.id } });
      } else {
        await tx.orderItem.update({
          where: { id: item.id },
          data: { quantity: next, unitPriceCents: priceFor(item.productId, next) },
        });
      }
    }
    for (const line of newLines) {
      const product = productMap.get(line.productId);
      if (!product) throw new OrderStateError("One of the added products could not be found.");
      const variant = product.variantAttributes as Record<string, string> | null;
      bump(line.productId, line.quantity);
      await tx.orderItem.create({
        data: {
          orderId: order.id,
          productId: product.id,
          variantLabel: variant ? Object.values(variant).join(" / ") : null,
          quantity: line.quantity,
          unitPriceCents: priceFor(line.productId, line.quantity),
        },
      });
    }

    for (const [productId, d] of [...delta].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (d === 0) continue;
      await recordStockMovementTx(tx, {
        organizationId: params.organizationId,
        productId,
        quantityDelta: -d, // more units: reserve (negative); fewer: release (positive)
        reason: d > 0 ? StockMovementReason.SALE_RESERVED : StockMovementReason.RESERVATION_RELEASED,
        reference: order.reference,
        note: `Order amended: ${reason}`,
        createdById: params.actorId,
      });
    }

    const items = await tx.orderItem.findMany({ where: { orderId: order.id }, include: { product: true } });
    const totalCents = computeTotal(items);
    const updated = await tx.order.update({ where: { id: order.id }, data: { totalCents } });

    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Order",
        entityId: order.id,
        action: "ORDER_AMENDED",
        actorId: params.actorId,
        before: { totalCents: order.totalCents, lines: before },
        after: {
          totalCents,
          reason,
          lines: items.map((i) => ({ sku: i.product.sku, quantity: i.quantity, unitPriceCents: i.unitPriceCents })),
        },
      },
      tx
    );
    return updated;
  });
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
  return transaction(params.organizationId, async (tx) => {
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

/**
 * Marks a confirmed order paid in full by hand (cash, bank transfer, anything
 * outside the Paystack flow) — writes the same Payment ledger an automated
 * provider payment does (see src/lib/payments.ts), so "amount paid" always
 * means one thing regardless of how it arrived.
 */
export async function markOrderPaid(params: { organizationId: string; orderId: string; actorId: string }) {
  return transaction(params.organizationId, async (tx) => {
    const order = await loadOrderForUpdate(tx, params.orderId, params.organizationId);
    if (order.status !== OrderStatus.CONFIRMED) {
      throw new OrderStateError("Only confirmed orders can be marked as paid.");
    }

    const alreadyPaidCents = await getPaidCents(tx, order.id);
    const remainingCents = order.totalCents - alreadyPaidCents;
    if (remainingCents <= 0) {
      throw new OrderStateError("This order is already fully paid.");
    }

    await writePayment(tx, order, { amountCents: remainingCents, method: PaymentMethod.MANUAL, recordedById: params.actorId, auditAction: "PAYMENT_MARKED_PAID" });

    return tx.order.findFirstOrThrow({ where: { id: order.id, organizationId: params.organizationId } });
  });
}

type ShipLine = { orderItemId: string; quantity: number };

/** Units of each order line already shipped. */
async function getShippedByItem(tx: TxClient, orderId: string) {
  const rows = await tx.shipmentItem.groupBy({
    by: ["orderItemId"],
    where: { shipment: { orderId } },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [r.orderItemId, r._sum.quantity ?? 0]));
}

/**
 * Ships all or part of a paid order. Each call is one physical dispatch
 * (a Shipment): its units leave physical and reserved stock together (available
 * is unchanged — it already dropped at confirmation). The order becomes
 * PARTIALLY_FULFILLED until every unit has shipped, then FULFILLED. Omit `items`
 * to ship everything still outstanding.
 */
export async function shipOrderItems(params: {
  organizationId: string;
  orderId: string;
  actorId: string;
  items?: ShipLine[];
  carrier?: string;
  trackingReference?: string;
  notes?: string;
}) {
  return transaction(params.organizationId, async (tx) => {
    const order = await loadOrderForUpdate(tx, params.orderId, params.organizationId);
    if (order.status !== OrderStatus.PAID && order.status !== OrderStatus.PARTIALLY_FULFILLED) {
      throw new OrderStateError("Only paid orders can be marked as fulfilled.");
    }

    const shipped = await getShippedByItem(tx, order.id);
    const remaining = new Map(order.items.map((i) => [i.id, i.quantity - (shipped.get(i.id) ?? 0)]));

    const lines: ShipLine[] =
      params.items ??
      order.items.filter((i) => (remaining.get(i.id) ?? 0) > 0).map((i) => ({ orderItemId: i.id, quantity: remaining.get(i.id)! }));
    if (lines.length === 0) throw new OrderStateError("Choose at least one item to ship.");

    const seen = new Set<string>();
    for (const line of lines) {
      const item = order.items.find((i) => i.id === line.orderItemId);
      if (!item) throw new OrderStateError("One of the selected items is not on this order.");
      if (seen.has(line.orderItemId)) throw new OrderStateError("Each item can only appear once in a shipment.");
      seen.add(line.orderItemId);
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        throw new OrderStateError("Shipment quantities must be whole numbers greater than zero.");
      }
      const left = remaining.get(item.id) ?? 0;
      if (line.quantity > left) {
        throw new OrderStateError(
          left === 0
            ? `${item.product.name} has already shipped in full.`
            : `Only ${left} of ${item.product.name} left to ship, but ${line.quantity} was entered.`
        );
      }
    }

    const byItem = new Map(order.items.map((i) => [i.id, i]));
    for (const line of sortByProductId(lines.map((l) => ({ ...l, productId: byItem.get(l.orderItemId)!.productId })))) {
      await recordStockMovementTx(tx, {
        organizationId: params.organizationId,
        productId: line.productId,
        quantityDelta: -line.quantity,
        reason: StockMovementReason.SALE_FULFILLED,
        reference: order.reference,
        createdById: params.actorId,
      });
    }

    const shipmentCount = await tx.shipment.count({ where: { orderId: order.id } });
    const shipment = await tx.shipment.create({
      data: {
        organizationId: params.organizationId,
        orderId: order.id,
        reference: `${order.reference}/${shipmentCount + 1}`,
        carrier: params.carrier?.trim() || null,
        trackingReference: params.trackingReference?.trim() || null,
        notes: params.notes?.trim() || null,
        createdById: params.actorId,
        items: { create: lines.map((l) => ({ orderItemId: l.orderItemId, quantity: l.quantity })) },
      },
    });

    const complete = order.items.every((i) => (remaining.get(i.id) ?? 0) - (lines.find((l) => l.orderItemId === i.id)?.quantity ?? 0) === 0);
    const updated = await tx.order.update({
      where: { id: order.id },
      data: complete
        ? { status: OrderStatus.FULFILLED, fulfilledAt: new Date() }
        : { status: OrderStatus.PARTIALLY_FULFILLED },
    });

    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Order",
        entityId: order.id,
        action: complete ? "ORDER_FULFILLED" : "ORDER_PARTIALLY_SHIPPED",
        actorId: params.actorId,
        before: { status: order.status },
        after: {
          status: updated.status,
          shipment: shipment.reference,
          units: lines.reduce((sum, l) => sum + l.quantity, 0),
          ...(shipment.trackingReference ? { tracking: shipment.trackingReference } : {}),
        },
      },
      tx
    );

    return { order: updated, shipment };
  });
}

/** Ships everything still outstanding on a paid or part-shipped order. */
export async function markOrderFulfilled(params: { organizationId: string; orderId: string; actorId: string }) {
  return (await shipOrderItems(params)).order;
}

/**
 * Owner closes a part-shipped order: the units that never shipped will not ship.
 * Their reservation is released back to available stock and the value of what was
 * paid for but not sent becomes a refund owed to the customer (kind UNSHIPPED).
 * The order is then complete (FULFILLED) at what actually shipped.
 */
export async function closeOrderShort(params: {
  organizationId: string;
  orderId: string;
  actorId: string;
  actorRole?: UserRole;
  reason: string;
}) {
  if (params.actorRole !== UserRole.OWNER) {
    throw new ReturnPermissionError("Only an owner can close an order short, because it means refunding the customer.");
  }
  const reason = params.reason.trim();
  if (!reason) throw new OrderStateError("Say why the rest of the order won't ship.");

  return transaction(params.organizationId, async (tx) => {
    const order = await loadOrderForUpdate(tx, params.orderId, params.organizationId);
    if (order.status !== OrderStatus.PARTIALLY_FULFILLED) {
      throw new OrderStateError("Only an order that has partly shipped can be closed short.");
    }
    const shipped = await getShippedByItem(tx, order.id);
    const unshipped = order.items
      .map((i) => ({ item: i, quantity: i.quantity - (shipped.get(i.id) ?? 0) }))
      .filter((u) => u.quantity > 0);
    if (unshipped.length === 0) throw new OrderStateError("Everything on this order has already shipped.");

    for (const u of sortByProductId(unshipped.map((x) => ({ ...x, productId: x.item.productId })))) {
      await recordStockMovementTx(tx, {
        organizationId: params.organizationId,
        productId: u.productId,
        quantityDelta: u.quantity,
        reason: StockMovementReason.RESERVATION_RELEASED,
        reference: order.reference,
        createdById: params.actorId,
      });
    }

    const refund = await createOwnerRefundTx(tx, {
      organizationId: params.organizationId,
      orderId: order.id,
      customerId: order.customerId,
      kind: "UNSHIPPED",
      reason,
      items: unshipped.map((u) => ({ orderItemId: u.item.id, quantity: u.quantity, unitPriceCents: u.item.unitPriceCents })),
      actor: { id: params.actorId, role: UserRole.OWNER },
    });

    const updated = await tx.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.FULFILLED, fulfilledAt: new Date() },
    });
    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Order",
        entityId: order.id,
        action: "ORDER_CLOSED_SHORT",
        actorId: params.actorId,
        before: { status: "PARTIALLY_FULFILLED" },
        after: {
          status: "FULFILLED",
          refundOwed: refund.reference,
          refundCents: refund.refundCents,
          unitsNotShipped: unshipped.reduce((sum, u) => sum + u.quantity, 0),
          reason,
        },
      },
      tx
    );
    return { order: updated, refund };
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
  return transaction(params.organizationId, async (tx) => {
    const order = await loadOrderForUpdate(tx, params.orderId, params.organizationId);
    const cancellable: OrderStatus[] = [OrderStatus.DRAFT, OrderStatus.CONFIRMED, OrderStatus.PAID];
    if (!cancellable.includes(order.status)) {
      throw new OrderStateError(
        order.status === OrderStatus.FULFILLED
          ? "A fulfilled order can't be cancelled — record a return instead."
          : order.status === OrderStatus.PARTIALLY_FULFILLED
            ? "Part of this order has already shipped — close the remainder short, or record a return for what was sent."
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
      const refund = await createOwnerRefundTx(tx, {
        organizationId: params.organizationId,
        orderId: order.id,
        customerId: order.customerId,
        kind: "CANCELLATION",
        reason: "Order cancelled after payment",
        items: order.items.map((i) => ({ orderItemId: i.id, quantity: i.quantity, unitPriceCents: i.unitPriceCents })),
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
