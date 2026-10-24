import Papa from "papaparse";
import { OrderStatus } from "@prisma/client";
import { tenantDb, transaction } from "@/lib/db";
import { getCustomerBalances } from "@/lib/balances";

export type Range = { from: Date; to: Date };

const COMMITTED: OrderStatus[] = [OrderStatus.CONFIRMED, OrderStatus.PAID, OrderStatus.PARTIALLY_FULFILLED, OrderStatus.FULFILLED];

/** Parses yyyy-mm-dd query parameters into an inclusive UTC range (default: the last 30 days). */
export function parseRange(from: string | undefined, to: string | undefined, now = new Date()): Range {
  const parse = (value: string | undefined, endOfDay: boolean) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const end = parse(to, true) ?? now;
  const start = parse(from, false) ?? new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

export type SalesReport = {
  /** Value of orders confirmed in the period (still standing: not cancelled). */
  orderValueCents: number;
  orderCount: number;
  averageOrderValueCents: number | null;
  /** Orders marked paid in the period — money in. */
  cashReceivedCents: number;
  /** Refunds actually paid out in the period — money out. */
  refundsPaidCents: number;
  /** cashReceived - refundsPaid. */
  netCashCents: number;
  /** As of now, not the period: confirmed orders nobody has paid for yet. */
  receivablesCents: number;
  /** As of now: refunds approved but not yet paid out. */
  refundsOwedCents: number;
  /** Gross margin, only over lines whose product has a cost recorded. Null when no line does. */
  margin: null | {
    marginCents: number;
    /** Share of the period's order lines (by revenue) that the margin covers. */
    coveragePercent: number;
    lines: number;
    linesWithCost: number;
  };
};

/**
 * The sales picture, with the money kept apart: order value is what was sold, cash is
 * what came in, receivables are what is still owed to us, refunds are what went back.
 * None of them is called profit. Margin appears only where a cost is on record and
 * says how much of the revenue it covers.
 */
export async function getSalesReport(organizationId: string, range: Range): Promise<SalesReport> {
  const db = tenantDb(organizationId);
  const inRange = { gte: range.from, lte: range.to };

  const [orders, cash, refundsPaid, receivables, refundsOwed, margin] = await Promise.all([
    db.order.aggregate({
      where: { organizationId, confirmedAt: inRange, status: { in: COMMITTED } },
      _sum: { totalCents: true },
      _count: true,
    }),
    // Any status: an order paid and later cancelled still brought cash in (the refund shows separately).
    db.order.aggregate({ where: { organizationId, paidAt: inRange }, _sum: { totalCents: true } }),
    db.orderReturn.aggregate({ where: { organizationId, refundStatus: "REFUNDED", refundedAt: inRange }, _sum: { refundCents: true } }),
    db.order.aggregate({ where: { organizationId, status: "CONFIRMED" }, _sum: { totalCents: true } }),
    db.orderReturn.aggregate({ where: { organizationId, refundStatus: "PENDING" }, _sum: { refundCents: true } }),
    transaction(organizationId, async (tx) => {
      const [row] = await tx.$queryRaw<
        { revenue: bigint | null; revenue_with_cost: bigint | null; margin: bigint | null; lines: bigint; lines_with_cost: bigint }[]
      >`
        SELECT SUM(oi."quantity" * oi."unitPriceCents") AS revenue,
               SUM(oi."quantity" * oi."unitPriceCents") FILTER (WHERE p."costCents" IS NOT NULL) AS revenue_with_cost,
               SUM(oi."quantity" * (oi."unitPriceCents" - p."costCents")) FILTER (WHERE p."costCents" IS NOT NULL) AS margin,
               count(*) AS lines,
               count(*) FILTER (WHERE p."costCents" IS NOT NULL) AS lines_with_cost
          FROM "OrderItem" oi
          JOIN "Order" o ON o."id" = oi."orderId"
          JOIN "Product" p ON p."id" = oi."productId"
         WHERE o."organizationId" = ${organizationId}
           AND o."confirmedAt" BETWEEN ${range.from} AND ${range.to}
           AND o."status"::text = ANY(${COMMITTED as string[]})`;
      return row;
    }),
  ]);

  const orderValueCents = orders._sum.totalCents ?? 0;
  const cashReceivedCents = cash._sum.totalCents ?? 0;
  const refundsPaidCents = refundsPaid._sum.refundCents ?? 0;
  const linesWithCost = Number(margin?.lines_with_cost ?? 0);
  const revenue = Number(margin?.revenue ?? 0);

  return {
    orderValueCents,
    orderCount: orders._count,
    averageOrderValueCents: orders._count === 0 ? null : Math.round(orderValueCents / orders._count),
    cashReceivedCents,
    refundsPaidCents,
    netCashCents: cashReceivedCents - refundsPaidCents,
    receivablesCents: receivables._sum.totalCents ?? 0,
    refundsOwedCents: refundsOwed._sum.refundCents ?? 0,
    margin:
      linesWithCost === 0
        ? null
        : {
            marginCents: Number(margin?.margin ?? 0),
            coveragePercent: revenue === 0 ? 0 : (Number(margin?.revenue_with_cost ?? 0) / revenue) * 100,
            lines: Number(margin?.lines ?? 0),
            linesWithCost,
          },
  };
}

export type DemandRow = { productId: string; sku: string; name: string; units: number; revenueCents: number; orders: number };

/** What sold, by product, in the period (confirmed orders that still stand). */
export async function getProductDemand(organizationId: string, range: Range, limit = 25): Promise<DemandRow[]> {
  const rows = await transaction(organizationId, (tx) =>
    tx.$queryRaw<{ id: string; sku: string; name: string; units: bigint; revenue: bigint; orders: bigint }[]>`
      SELECT p."id", p."sku", p."name",
             SUM(oi."quantity") AS units,
             SUM(oi."quantity" * oi."unitPriceCents") AS revenue,
             count(DISTINCT o."id") AS orders
        FROM "OrderItem" oi
        JOIN "Order" o ON o."id" = oi."orderId"
        JOIN "Product" p ON p."id" = oi."productId"
       WHERE o."organizationId" = ${organizationId}
         AND o."confirmedAt" BETWEEN ${range.from} AND ${range.to}
         AND o."status"::text = ANY(${COMMITTED as string[]})
       GROUP BY p."id", p."sku", p."name"
       ORDER BY units DESC, p."name" ASC
       LIMIT ${limit}`
  );
  return rows.map((r) => ({
    productId: r.id,
    sku: r.sku,
    name: r.name,
    units: Number(r.units),
    revenueCents: Number(r.revenue),
    orders: Number(r.orders),
  }));
}

export type StockMovementRow = { reason: string; movements: number; physical: number; reserved: number; damaged: number };

/** Stock movement in the period, by reason — straight from the ledger. */
export async function getStockMovementSummary(organizationId: string, range: Range): Promise<StockMovementRow[]> {
  const rows = await tenantDb(organizationId).stockMovement.groupBy({
    by: ["reason"],
    where: { organizationId, createdAt: { gte: range.from, lte: range.to } },
    _sum: { physicalDelta: true, reservedDelta: true, damagedDelta: true },
    _count: true,
  });
  return rows
    .map((r) => ({
      reason: r.reason,
      movements: r._count,
      physical: r._sum.physicalDelta ?? 0,
      reserved: r._sum.reservedDelta ?? 0,
      damaged: r._sum.damagedDelta ?? 0,
    }))
    .sort((a, b) => b.movements - a.movements);
}

export type OutstandingRow = {
  customerId: string;
  name: string;
  phone: string;
  owesUsCents: number;
  weOweCents: number;
  netCents: number;
};

/** Customers who owe us, or whom we owe — as of now. */
export async function getOutstandingBalances(organizationId: string): Promise<OutstandingRow[]> {
  const balances = await getCustomerBalances(organizationId);
  const open = [...balances].filter(([, b]) => b.outstandingCents > 0 || b.refundDueCents > 0);
  if (open.length === 0) return [];
  const customers = await tenantDb(organizationId).customer.findMany({
    where: { organizationId, id: { in: open.map(([id]) => id) } },
  });
  const byId = new Map(customers.map((c) => [c.id, c]));
  return open
    .map(([id, b]) => ({
      customerId: id,
      name: byId.get(id)?.name ?? "Unnamed",
      phone: byId.get(id)?.phone ?? "",
      owesUsCents: b.outstandingCents,
      weOweCents: b.refundDueCents,
      netCents: b.balanceCents,
    }))
    .sort((a, b) => b.netCents - a.netCents);
}

/**
 * A spreadsheet that opens a CSV may treat a cell starting with = + - @ as a formula —
 * and a customer name, a product name or a note is text anyone could have typed. Prefixing
 * such cells with a quote makes them inert text, so exporting data can't turn into running
 * somebody's formula on the finance person's laptop.
 */
export function csvSafe(value: string | number | null | undefined): string | number {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]) {
  return Papa.unparse({ fields: headers, data: rows.map((row) => row.map(csvSafe)) });
}
