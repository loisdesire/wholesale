import { OrderStatus, RefundStatus, ReturnKind, ReturnStatus } from "@prisma/client";
import { tenantDb } from "@/lib/db";

/**
 * What a customer owes us and what we owe them, summed from orders and returns.
 * Like stock, a balance is never a stored number — it can't drift from the
 * records behind it. Cash/revenue are kept separate on purpose: "cash received"
 * is what customers have paid for paid/fulfilled orders, net of refunds actually
 * paid out; it is not profit and not the same as order value.
 */
export type CustomerBalance = {
  /** Confirmed orders the customer has not yet paid for (a receivable). */
  outstandingCents: number;
  /** Totals of orders marked paid or fulfilled. */
  paidCents: number;
  /** Refunds actually paid out to the customer. */
  refundedCents: number;
  /** Approved refunds not yet paid out (a payable). */
  refundDueCents: number;
  /** Refunds on returns still awaiting the owner's decision (not yet owed). */
  refundRequestedCents: number;
  /** paidCents - refundedCents. */
  cashReceivedCents: number;
  /** outstanding - refundDue: positive means the customer owes us, negative means we owe them. */
  balanceCents: number;
};

export const EMPTY_BALANCE: CustomerBalance = {
  outstandingCents: 0,
  paidCents: 0,
  refundedCents: 0,
  refundDueCents: 0,
  refundRequestedCents: 0,
  cashReceivedCents: 0,
  balanceCents: 0,
};

/** Balances for the given customers (or every customer in the organization when omitted). */
export async function getCustomerBalances(organizationId: string, customerIds?: string[]) {
  const customerFilter = customerIds ? { customerId: { in: customerIds } } : {};

  const db = tenantDb(organizationId);
  const [orderRows, returnRows] = await Promise.all([
    db.order.groupBy({
      by: ["customerId", "status"],
      where: { organizationId, ...customerFilter, status: { in: [OrderStatus.CONFIRMED, OrderStatus.PAID, OrderStatus.PARTIALLY_FULFILLED, OrderStatus.FULFILLED] } },
      _sum: { totalCents: true },
    }),
    db.orderReturn.groupBy({
      by: ["customerId", "kind", "status", "refundStatus"],
      where: { organizationId, ...customerFilter, status: { not: ReturnStatus.REJECTED } },
      _sum: { refundCents: true },
    }),
  ]);

  const partial = new Map<string, Omit<CustomerBalance, "cashReceivedCents" | "balanceCents">>();
  const get = (id: string) => {
    let row = partial.get(id);
    if (!row) {
      row = { outstandingCents: 0, paidCents: 0, refundedCents: 0, refundDueCents: 0, refundRequestedCents: 0 };
      partial.set(id, row);
    }
    return row;
  };

  for (const r of orderRows) {
    const total = r._sum.totalCents ?? 0;
    if (r.status === OrderStatus.CONFIRMED) get(r.customerId).outstandingCents += total;
    else get(r.customerId).paidCents += total;
  }
  for (const r of returnRows) {
    const cents = r._sum.refundCents ?? 0;
    const row = get(r.customerId);
    // A cancelled order drops out of the order totals above, but the customer
    // did pay for it — count that cash so the refund doesn't subtract from nothing.
    if (r.kind === ReturnKind.CANCELLATION) row.paidCents += cents;
    if (r.refundStatus === RefundStatus.REFUNDED) row.refundedCents += cents;
    else if (r.refundStatus === RefundStatus.PENDING) row.refundDueCents += cents;
    else if (r.status === ReturnStatus.REQUESTED) row.refundRequestedCents += cents;
  }

  const result = new Map<string, CustomerBalance>();
  for (const [id, row] of partial) {
    result.set(id, {
      ...row,
      cashReceivedCents: row.paidCents - row.refundedCents,
      balanceCents: row.outstandingCents - row.refundDueCents,
    });
  }
  return result;
}
