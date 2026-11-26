import { OrderStatus } from "@prisma/client";
import { tenantDb } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { ensurePublicToken, trackingUrl } from "@/lib/order-tracking";
import type { CatalogueMatch } from "@/lib/ai/catalogue-search";

/**
 * What the AI is allowed to know about orders: open drafts in the current chat (so it never drafts
 * the same order twice) and the *current customer's own* orders (so it can answer "where is my
 * order?"). The customer id always comes from the conversation, never from anything the model
 * or the customer types, so one customer can never be shown another's order.
 */

export type DraftSummary = {
  id: string;
  reference: string;
  totalCents: number;
  items: { orderItemId: string; productId: string; quantity: number; label: string }[];
};

/** Open drafts raised in this conversation, newest first. */
export async function listOpenDrafts(organizationId: string, conversationId: string): Promise<DraftSummary[]> {
  const orders = await tenantDb(organizationId).order.findMany({
    where: { organizationId, conversationId, status: OrderStatus.DRAFT },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      reference: true,
      totalCents: true,
      items: { select: { id: true, productId: true, quantity: true, variantLabel: true, product: { select: { name: true } } } },
    },
  });
  return orders.map((o) => ({
    id: o.id,
    reference: o.reference,
    totalCents: o.totalCents,
    items: o.items.map((i) => ({
      orderItemId: i.id,
      productId: i.productId,
      quantity: i.quantity,
      label: `${i.product.name}${i.variantLabel ? ` (${i.variantLabel})` : ""}`,
    })),
  }));
}

/** Sums repeated lines for the same product, so [{p,2},{p,3}] and [{p,5}] compare equal. */
export function mergeItems(items: { productId: string; quantity: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of items) m.set(i.productId, (m.get(i.productId) ?? 0) + i.quantity);
  return m;
}

export function sameItems(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

export function sameProducts(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const k of a.keys()) if (!b.has(k)) return false;
  return true;
}

/** Plain-text summary of open drafts, shown to the model at the start of every turn. */
export function describeDrafts(drafts: DraftSummary[]): string | null {
  if (drafts.length === 0) return null;
  const lines = drafts.map(
    (d) => `${d.reference}: ${d.items.map((i) => `${i.quantity} × ${i.label}`).join(", ")} — total ${formatMoney(d.totalCents)}`
  );
  return `Open draft orders already created in this chat (awaiting staff confirmation): ${lines.join(" | ")}. Do not create these again. If the customer is just agreeing to one of them, tell them it is drafted and a staff member will confirm.`;
}

const STATUS_TEXT: Record<OrderStatus, string> = {
  DRAFT: "drafted, waiting for staff to confirm",
  CONFIRMED: "confirmed, waiting for payment",
  PAID: "paid, being prepared for shipping",
  PARTIALLY_FULFILLED: "partly shipped",
  FULFILLED: "shipped",
  CANCELLED: "cancelled",
};

export type CustomerOrderView = {
  reference: string;
  status: string;
  placedOn: string;
  total: string;
  items: string[];
  shipments: { shippedOn: string; units: number; carrier: string | null; trackingNumber: string | null }[];
  statusPage?: string;
};

/** The customer's own recent orders, in words the model can pass on. Never includes another customer's data. */
export async function getCustomerOrdersForAI(organizationId: string, customerId: string, limit = 5): Promise<CustomerOrderView[]> {
  const db = tenantDb(organizationId);
  const orders = await db.order.findMany({
    where: { organizationId, customerId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      reference: true,
      status: true,
      totalCents: true,
      createdAt: true,
      items: { select: { quantity: true, variantLabel: true, product: { select: { name: true } } } },
      shipments: { select: { carrier: true, trackingReference: true, createdAt: true, items: { select: { quantity: true } } }, orderBy: { createdAt: "asc" } },
    },
  });

  const appUrlSet = Boolean((process.env.APP_URL ?? "").trim());
  const views: CustomerOrderView[] = [];
  for (const o of orders) {
    const view: CustomerOrderView = {
      reference: o.reference,
      status: STATUS_TEXT[o.status],
      placedOn: o.createdAt.toISOString().slice(0, 10),
      total: formatMoney(o.totalCents),
      items: o.items.map((i) => `${i.quantity} × ${i.product.name}${i.variantLabel ? ` (${i.variantLabel})` : ""}`),
      shipments: o.shipments.map((s) => ({
        shippedOn: s.createdAt.toISOString().slice(0, 10),
        units: s.items.reduce((n, x) => n + x.quantity, 0),
        carrier: s.carrier,
        trackingNumber: s.trackingReference,
      })),
    };
    // A link only helps in a chat if it is a full address; without APP_URL it would be a bare path.
    if (appUrlSet && o.status !== OrderStatus.DRAFT && o.status !== OrderStatus.CANCELLED) {
      view.statusPage = trackingUrl(organizationId, await ensurePublicToken(organizationId, o.id));
    }
    views.push(view);
  }
  return views;
}

/**
 * The shape of a catalogue entry shown to the model. Money is given as ready-made text
 * ("₦3,500") and the raw kobo figures are withheld: with only `priceCents: 350000` the model
 * sometimes mis-converted and quoted ₦35,000 for a ₦3,500 item.
 */
export function catalogueEntryForModel(m: CatalogueMatch) {
  const { priceCents, priceTiers, ...rest } = m;
  return {
    ...rest,
    price: formatMoneyExact(priceCents),
    priceTiers: priceTiers.map((t) => ({ minQuantity: t.minQuantity, price: formatMoneyExact(t.priceCents) })),
  };
}

/** Like formatMoney, but keeps kobo when there are any (₦1,250.50), so nothing is silently rounded. */
export function formatMoneyExact(cents: number): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(cents / 100);
}
