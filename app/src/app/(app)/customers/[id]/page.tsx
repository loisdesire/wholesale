import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EMPTY_BALANCE, getCustomerBalances } from "@/lib/balances";
import { formatDateTime, formatMoney } from "@/lib/format";
import { OrderStatusBadge, RefundStatusBadge, ReturnStatusBadge } from "@/components/status-badge";
import { findPossibleDuplicates } from "@/lib/customers";
import { removeAddressAction, removePriceAction, setDefaultAddressAction } from "../actions";
import { AddAddressForm, AgreedPriceForm, EditCustomerForm } from "./customer-forms";

const ACTIVITY_LABEL: Record<string, string> = {
  CUSTOMER_CREATED: "Customer added",
  CUSTOMER_UPDATED: "Details updated",
  ADDRESS_ADDED: "Address added",
  ADDRESS_REMOVED: "Address removed",
  DEFAULT_ADDRESS_CHANGED: "Default address changed",
  CUSTOM_PRICE_SET: "Agreed price set",
  CUSTOM_PRICE_REMOVED: "Agreed price removed",
};

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const organizationId = session!.user.organizationId;

  const customer = await prisma.customer.findFirst({ where: { id, organizationId } });
  if (!customer) notFound();

  const isOwner = session!.user.role === "OWNER";
  const [balances, orders, returns, addresses, agreedPrices, products, duplicates, activity] = await Promise.all([
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
    prisma.customerAddress.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: "asc" } }),
    prisma.customerPrice.findMany({
      where: { customerId: customer.id },
      include: { product: true },
      orderBy: { createdAt: "asc" },
    }),
    isOwner
      ? prisma.product.findMany({ where: { organizationId, active: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    findPossibleDuplicates(organizationId, customer.id),
    prisma.auditLog.findMany({
      where: { organizationId, entity: "Customer", entityId: customer.id },
      include: { actor: true },
      orderBy: { createdAt: "desc" },
      take: 30,
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

      {duplicates.length > 0 && (
        <section className="rounded-md border border-line bg-status-attention-bg px-4 py-3 text-sm">
          <h2 className="font-medium text-status-attention-fg">Possible duplicate customers</h2>
          <p className="mt-1 text-text-muted">
            These records might be the same person. Nothing is merged automatically — check before treating them as one.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {duplicates.map((d) => (
              <li key={d.customer.id}>
                <Link href={`/customers/${d.customer.id}`} className="text-ink underline underline-offset-2">
                  {d.customer.name ?? "Unnamed"} · {d.customer.phone}
                </Link>
                <span className="text-text-muted"> — {d.reasons.join("; ")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

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
        <h2 className="mb-3 text-sm font-medium text-ink">Details</h2>
        <EditCustomerForm customerId={customer.id} name={customer.name} email={customer.email} notes={customer.notes} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink">Delivery addresses</h2>
        {addresses.length > 0 && (
          <ul className="mb-3 divide-y divide-line rounded-md border border-line bg-surface">
            {addresses.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <div>
                  <p className="text-ink">
                    {a.label ? `${a.label} · ` : ""}
                    {a.text}
                    {a.isDefault && (
                      <span className="ml-2 rounded-full bg-status-neutral-bg px-2 py-0.5 text-xs text-status-neutral-fg">
                        Default
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex gap-3 text-xs">
                  {!a.isDefault && (
                    <form action={setDefaultAddressAction.bind(null, customer.id, a.id)}>
                      <button type="submit" className="text-ink underline-offset-2 hover:underline">
                        Make default
                      </button>
                    </form>
                  )}
                  <form action={removeAddressAction.bind(null, customer.id, a.id)}>
                    <button type="submit" className="text-status-attention-fg underline-offset-2 hover:underline">
                      Remove
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="max-w-xl">
          <AddAddressForm customerId={customer.id} />
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-sm font-medium text-ink">Agreed prices</h2>
        <p className="mb-3 text-sm text-text-muted">
          A price agreed with this customer beats the list price and quantity breaks on new orders. Orders already
          placed keep the price they were made at.
        </p>
        {agreedPrices.length > 0 && (
          <table className="mb-3 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
                <th className="py-2 pr-4">Product</th>
                <th className="py-2 pr-4 text-right">List price</th>
                <th className="py-2 pr-4 text-right">Agreed price</th>
                {isOwner && <th className="py-2" />}
              </tr>
            </thead>
            <tbody>
              {agreedPrices.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0">
                  <td className="py-3 pr-4 text-ink">
                    {p.product.name}
                    <span className="ml-2 font-tabular text-xs text-text-muted">{p.product.sku}</span>
                  </td>
                  <td className="py-3 pr-4 text-right font-tabular text-text-muted">{formatMoney(p.product.priceCents)}</td>
                  <td className="py-3 pr-4 text-right font-tabular text-ink">{formatMoney(p.priceCents)}</td>
                  {isOwner && (
                    <td className="py-3 text-right">
                      <form action={removePriceAction.bind(null, customer.id, p.productId)}>
                        <button type="submit" className="text-xs text-status-attention-fg underline-offset-2 hover:underline">
                          Remove
                        </button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {isOwner ? (
          <div className="max-w-xl">
            <AgreedPriceForm
              customerId={customer.id}
              products={products.map((p) => ({
                id: p.id,
                label: `${p.name}${p.variantAttributes ? ` (${Object.values(p.variantAttributes as Record<string, string>).join(" / ")})` : ""}`,
                priceNaira: p.priceCents / 100,
              }))}
            />
          </div>
        ) : (
          <p className="text-sm text-text-muted">Only an owner can set agreed prices.</p>
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

      {activity.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-ink">Activity</h2>
          <div className="divide-y divide-line rounded-md border border-line bg-surface">
            {activity.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-ink">{ACTIVITY_LABEL[entry.action] ?? entry.action}</span>
                <span className="text-xs text-text-muted">
                  {entry.actor?.name ?? "System"} · {formatDateTime(entry.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

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
