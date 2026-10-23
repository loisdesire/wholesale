import { OrderStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Prisma's `contains` becomes LIKE '%…%' without escaping, so a user typing "%"
 * or "_" would match everything (and "50%" would match "50 anything"). Escape
 * LIKE's metacharacters so what people type is matched literally.
 */
export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

/** Case-insensitive "contains", matching the text literally. */
export const ci = (value: string) => ({ contains: escapeLike(value), mode: "insensitive" as const });

/**
 * Digit fragments a typed phone query should match against Customer.phoneKey,
 * which is stored as full international digits ("2348031234567"). A staff member
 * types "0803 123", "803123" or "+234 803" — each reduces to digits we can find
 * inside the key. Returns [] when the query doesn't look like part of a number.
 */
export function phoneFragments(q: string): string[] {
  if (!/^[\d\s+()-]{3,}$/.test(q.trim())) return [];
  const digits = q.replace(/\D/g, "");
  if (digits.length < 3) return [];
  const withoutLeadingZero = digits.replace(/^0+/, "");
  return [...new Set([digits, withoutLeadingZero].filter((d) => d.length >= 3))];
}

/** Customers whose name, email, notes or phone match the text. */
export function customerMatch(q: string): Prisma.CustomerWhereInput {
  const text = q.trim();
  return {
    OR: [
      { name: ci(text) },
      { email: ci(text) },
      { notes: ci(text) },
      ...phoneFragments(text).map((d) => ({ phoneKey: { contains: d } })),
    ],
  };
}

export type OrderFilters = {
  q?: string;
  status?: OrderStatus;
  /** Inclusive ISO dates (yyyy-mm-dd). */
  from?: string;
  to?: string;
};

export function parseOrderStatus(value: string | undefined): OrderStatus | undefined {
  return value && (Object.values(OrderStatus) as string[]).includes(value) ? (value as OrderStatus) : undefined;
}

function parseDay(value: string | undefined, endOfDay: boolean) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** The where-clause behind the orders list (and anything else filtering orders the same way). */
export function buildOrderWhere(organizationId: string, filters: OrderFilters): Prisma.OrderWhereInput {
  const text = filters.q?.trim();
  const from = parseDay(filters.from, false);
  const to = parseDay(filters.to, true);
  return {
    organizationId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(text
      ? {
          OR: [
            { reference: ci(text) },
            { notes: ci(text) },
            { deliveryAddress: ci(text) },
            { customer: customerMatch(text) },
            { items: { some: { product: { OR: [{ name: ci(text) }, { sku: ci(text) }] } } } },
          ],
        }
      : {}),
  };
}

/** One query box over everything: orders, customers, products and returns. */
export async function searchEverything(organizationId: string, query: string, limit = 8) {
  const q = query.trim();
  if (q.length < 2) return { orders: [], customers: [], products: [], returns: [] };

  const [orders, customers, products, returns] = await Promise.all([
    prisma.order.findMany({
      where: buildOrderWhere(organizationId, { q }),
      include: { customer: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.customer.findMany({
      where: { organizationId, mergedIntoId: null, ...customerMatch(q) },
      orderBy: { name: "asc" },
      take: limit,
    }),
    prisma.product.findMany({
      where: { organizationId, OR: [{ name: ci(q) }, { sku: ci(q) }] },
      orderBy: { name: "asc" },
      take: limit,
    }),
    prisma.orderReturn.findMany({
      where: { organizationId, OR: [{ reference: ci(q) }, { reason: ci(q) }, { customer: customerMatch(q) }] },
      include: { customer: true, order: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);
  return { orders, customers, products, returns };
}
