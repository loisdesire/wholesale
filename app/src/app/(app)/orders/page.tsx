import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDateTime, formatMoney } from "@/lib/format";
import { OrderStatusBadge } from "@/components/status-badge";

export default async function OrdersPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId;

  const orders = await prisma.order.findMany({
    where: { organizationId },
    include: { customer: true, items: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-medium text-ink">Orders</h1>
          <p className="mt-1 text-sm text-text-muted">
            Draft, confirmed, paid, and fulfilled — every order in one place.
          </p>
        </div>
        <Link
          href="/orders/new"
          className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-paper transition-colors hover:bg-ink-2"
        >
          New order
        </Link>
      </header>

      {orders.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-text-muted">
          No orders yet.{" "}
          <Link href="/orders/new" className="text-ink underline underline-offset-2">
            Create the first one
          </Link>
          .
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
              <th className="py-2 pr-4">Reference</th>
              <th className="py-2 pr-4">Customer</th>
              <th className="py-2 pr-4">Items</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Created</th>
              <th className="py-2 pr-4 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-line last:border-0">
                <td className="py-3 pr-4 font-tabular">
                  <Link href={`/orders/${o.id}`} className="text-ink hover:underline">
                    {o.reference}
                  </Link>
                </td>
                <td className="py-3 pr-4">
                  <p className="text-ink">{o.customer.name ?? "Unnamed"}</p>
                  <p className="font-tabular text-xs text-text-muted">{o.customer.phone}</p>
                </td>
                <td className="py-3 pr-4 text-text-muted">
                  {o.items.reduce((sum, i) => sum + i.quantity, 0)} units
                </td>
                <td className="py-3 pr-4">
                  <OrderStatusBadge status={o.status} />
                </td>
                <td className="py-3 pr-4 text-xs text-text-muted">
                  {formatDateTime(o.createdAt)}
                </td>
                <td className="py-3 pr-4 text-right font-tabular text-ink">
                  {formatMoney(o.totalCents, o.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
