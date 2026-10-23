import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EMPTY_BALANCE, getCustomerBalances } from "@/lib/balances";
import { formatDateTime, formatMoney } from "@/lib/format";
import { OrderStatusBadge, RefundStatusBadge, ReturnStatusBadge } from "@/components/status-badge";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const organizationId = session!.user.organizationId;

  const customer = await prisma.customer.findFirst({ where: { id, organizationId } });
  if (!customer) notFound();

  const [balances, orders, returns] = await Promise.all([
    getCustomerBalances(organizationId, [customer.id]),
    prisma.order.findMany({
      where: { organizationId, customerId: customer.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.orderReturn.findMany({
      where: { organizationId, customerId: customer.id },
      include: { order: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const balance = balances.get(customer.id) ?? EMPTY_BALANCE;

  const figures = [
    { label: "Owes us", value: balance.outstandingCents, hint: "Confirmed orders not yet paid" },
    { label: "We owe", value: balance.refundDueCents, hint: "Approved refunds not yet paid out", attention: true },
    { label: "Cash received", value: balance.cashReceivedCents, hint: "Paid orders, less refunds paid out" },
    { label: "Refunded", value: balance.refundedCents, hint: "Paid back to the customer" },
  ];
  const netLabel =
    balance.balanceCents > 0
      ? `Net: the customer owes us ${formatMoney(balance.balanceCents)}`
      : balance.balanceCents < 0
        ? `Net: we owe the customer ${formatMoney(-balance.balanceCents)}`
        : "Net: settled";

  return (
    <div className="flex flex-col gap-10">
      <header>
        <Link href="/customers" className="text-sm text-text-muted hover:text-ink">
          ← Customers
        </Link>
        <h1 className="mt-2 text-xl font-medium text-ink">{customer.name ?? "Unnamed"}</h1>
        <p className="mt-1 font-tabular text-sm text-text-muted">{customer.phone}</p>
        {customer.notes && <p className="mt-2 max-w-xl text-sm text-text-muted">{customer.notes}</p>}
      </header>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink">Balance</h2>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line md:grid-cols-4">
          {figures.map((f) => (
            <div key={f.label} className="bg-surface p-4">
              <dt className="text-xs text-text-muted">{f.label}</dt>
              <dd
                className={`mt-1 font-tabular text-lg font-medium ${
                  f.attention && f.value > 0 ? "text-status-attention-fg" : "text-ink"
                }`}
              >
                {formatMoney(f.value)}
              </dd>
              <p className="mt-1 text-xs text-text-muted">{f.hint}</p>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm text-ink">{netLabel}</p>
        {balance.refundRequestedCents > 0 && (
          <p className="mt-1 text-sm text-text-muted">
            A further {formatMoney(balance.refundRequestedCents)} is on returns still awaiting the owner&apos;s decision.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink">Orders</h2>
        {orders.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-text-muted">
            No orders yet.
          </p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
                <th className="py-2 pr-4">Order</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Placed</th>
                <th className="py-2 pr-4 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-line last:border-0">
                  <td className="py-3 pr-4 font-tabular text-ink">
                    <Link href={`/orders/${o.id}`} className="underline-offset-2 hover:underline">
                      {o.reference}
                    </Link>
                  </td>
                  <td className="py-3 pr-4">
                    <OrderStatusBadge status={o.status} />
                  </td>
                  <td className="py-3 pr-4 text-xs text-text-muted">{formatDateTime(o.createdAt)}</td>
                  <td className="py-3 pr-4 text-right font-tabular text-ink">{formatMoney(o.totalCents, o.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {returns.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-ink">Returns &amp; refunds</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
                <th className="py-2 pr-4">Return</th>
                <th className="py-2 pr-4">Order</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Refund</th>
                <th className="py-2 pr-4 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {returns.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="py-3 pr-4 font-tabular text-ink">{r.reference}</td>
                  <td className="py-3 pr-4 font-tabular">
                    <Link href={`/orders/${r.orderId}`} className="text-ink underline-offset-2 hover:underline">
                      {r.order.reference}
                    </Link>
                  </td>
                  <td className="py-3 pr-4">
                    <ReturnStatusBadge status={r.status} />
                  </td>
                  <td className="py-3 pr-4">
                    {r.status === "REJECTED" || r.status === "REQUESTED" ? (
                      <span className="text-xs text-text-muted">—</span>
                    ) : (
                      <RefundStatusBadge status={r.refundStatus} />
                    )}
                  </td>
                  <td className="py-3 pr-4 text-right font-tabular text-ink">{formatMoney(r.refundCents, r.order.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
