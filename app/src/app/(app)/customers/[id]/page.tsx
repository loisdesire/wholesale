import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { EMPTY_BALANCE, getCustomerBalances } from "@/lib/balances";
import { formatDateTime, formatMoney } from "@/lib/format";
import { OrderStatusBadge, RefundStatusBadge, ReturnStatusBadge } from "@/components/status-badge";
import { findPossibleDuplicates } from "@/lib/customers";
import { removeAddressAction, removePriceAction, setDefaultAddressAction, undoMergeAction } from "../actions";
import { AddAddressForm, AgreedPriceForm, EditCustomerForm } from "./customer-forms";
import {
  ArrowLeft,
  Plus,
  AlertCircle,
} from "lucide-react";

const ACTIVITY_LABEL: Record<string, string> = {
  CUSTOMER_CREATED: "Customer registered",
  CUSTOMER_UPDATED: "Contact details updated",
  ADDRESS_ADDED: "Delivery address added",
  ADDRESS_REMOVED: "Address deleted",
  DEFAULT_ADDRESS_CHANGED: "Default address set",
  CUSTOM_PRICE_SET: "Agreed wholesale price locked",
  CUSTOM_PRICE_REMOVED: "Agreed price removed",
  CUSTOMER_MERGED_INTO: "Merged into primary profile",
  CUSTOMER_MERGED_FROM: "Profile merged into this account",
  CUSTOMER_MERGE_UNDONE: "Account merge undone",
};

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const organizationId = session!.user.organizationId;
  const db = tenantDb(organizationId);

  const customer = await db.customer.findFirst({ where: { id, organizationId } });
  if (!customer) notFound();

  const isOwner = session!.user.role === "OWNER";
  const mergedInto = customer.mergedIntoId
    ? await db.customer.findUnique({ where: { id: customer.mergedIntoId } })
    : null;
  const archivedBy = mergedInto
    ? await db.customerMerge.findFirst({ where: { organizationId, sourceId: customer.id, undoneAt: null } })
    : null;
  const [balances, orders, returns, addresses, agreedPrices, products, duplicates, activity] = await Promise.all([
    getCustomerBalances(organizationId, [customer.id]),
    db.order.findMany({
      where: { organizationId, customerId: customer.id },
      orderBy: { createdAt: "desc" },
    }),
    db.orderReturn.findMany({
      where: { organizationId, customerId: customer.id },
      include: { order: true },
      orderBy: { createdAt: "desc" },
    }),
    db.customerAddress.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: "asc" } }),
    db.customerPrice.findMany({
      where: { customerId: customer.id },
      include: { product: true },
      orderBy: { createdAt: "asc" },
    }),
    isOwner
      ? db.product.findMany({ where: { organizationId, active: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    findPossibleDuplicates(organizationId, customer.id),
    db.auditLog.findMany({
      where: { organizationId, entity: "Customer", entityId: customer.id },
      include: { actor: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);
  const balance = balances.get(customer.id) ?? EMPTY_BALANCE;

  const figures = [
    { label: "Receivables (Owes Us)", value: balance.outstandingCents, hint: "Confirmed unbilled / unpaid orders", isAttention: balance.outstandingCents > 0, tone: "amber" },
    { label: "Payables (We Owe)", value: balance.refundDueCents, hint: "Approved customer refunds pending settlement", isAttention: balance.refundDueCents > 0, tone: "rose" },
    { label: "Settled Inflow", value: balance.cashReceivedCents, hint: "Total net payments recorded to date", isAttention: false, tone: "ink" },
    { label: "Refunds Settled", value: balance.refundedCents, hint: "Total returned funds disbursed", isAttention: false, tone: "muted" },
  ];

  return (
    <div className="flex flex-col gap-6 pb-16">
      {/* Top Header Card */}
      <header className="card-base flex flex-col gap-4 rounded-2xl p-5 sm:p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/customers"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-paper/60 text-ink hover:bg-paper transition-colors"
              title="Return to customer directory"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                {customer.name ?? "Unnamed Customer"}
              </h1>
              <p className="mt-0.5 font-tabular text-xs text-text-muted flex items-center gap-2">
                <span>Phone: <strong className="font-medium text-ink">{customer.phone}</strong></span>
                {customer.email && (
                  <>
                    <span>·</span>
                    <span>Email: <strong className="font-medium text-ink">{customer.email}</strong></span>
                  </>
                )}
              </p>
            </div>
          </div>

          <Link
            href={`/orders/new?customerId=${customer.id}`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white shadow-xs shadow-accent/25 transition-all hover:bg-accent-2 cursor-pointer"
          >
            <Plus className="h-4 w-4 stroke-[2.5]" />
            <span>New Order</span>
          </Link>
        </div>

        {customer.notes && (
          <div className="border-t border-line/60 pt-3">
            <p className="text-xs text-text-muted leading-relaxed bg-paper/50 rounded-xl p-3 border border-line/60">
              <strong className="text-ink font-semibold">Account Notes:</strong> {customer.notes}
            </p>
          </div>
        )}
      </header>

      {/* Merged Notice Banner */}
      {mergedInto && (
        <div className="rounded-2xl border border-line bg-paper/50 p-4 text-xs text-ink flex items-center justify-between">
          <p>
            This buyer account was merged into{" "}
            <Link href={`/customers/${mergedInto.id}`} className="font-semibold text-accent underline">
              {mergedInto.name ?? mergedInto.phone}
            </Link>{" "}
            on {formatDateTime(customer.mergedAt!)}.
          </p>
          {isOwner && archivedBy && (
            <form action={undoMergeAction.bind(null, archivedBy.id, customer.id)}>
              <button type="submit" className="font-semibold text-accent hover:underline cursor-pointer">
                Undo merge
              </button>
            </form>
          )}
        </div>
      )}

      {/* Duplicates Alert */}
      {duplicates.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-900 space-y-2">
          <div className="flex items-center gap-2 font-bold">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <span>Potential Duplicate Customer Profile Detected</span>
          </div>
          <ul className="space-y-1 pl-6 list-disc">
            {duplicates.map((d) => (
              <li key={d.customer.id}>
                <span>
                  {d.customer.name ?? "Unnamed"} ({d.customer.phone}) — {d.reasons.join(", ")}
                </span>
                {isOwner && !mergedInto && (
                  <Link
                    href={`/customers/${customer.id}/merge?with=${d.customer.id}`}
                    className="font-semibold underline ml-2 text-amber-950"
                  >
                    Review Merge →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Financial Health / Balances Strip */}
      <div className="card-base rounded-2xl p-5 shadow-xs">
        <div className="border-b border-line/60 pb-3 mb-4">
          <h2 className="font-display text-sm font-bold text-ink">Account Balance &amp; Settlement Ledger</h2>
          <p className="text-xs text-text-muted">Derived directly from immutable order payments and approved returns.</p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {figures.map((f) => (
            <div key={f.label} className="rounded-xl border border-line bg-paper/40 p-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink/80">
                {f.label}
              </span>
              <p
                className={`mt-1 font-tabular text-xl sm:text-2xl font-bold ${
                  f.tone === "rose" && f.isAttention
                    ? "text-rose-600"
                    : f.tone === "amber" && f.isAttention
                      ? "text-amber-800"
                      : "text-ink"
                }`}
              >
                {formatMoney(f.value)}
              </p>
              <p className="mt-1 text-xs text-text-muted leading-tight">{f.hint}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Main 2-Column Responsive Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column (2 Cols): Orders, Agreed Prices, Returns */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer Orders Table Card */}
          <div className="card-base overflow-hidden rounded-2xl shadow-xs">
            <div className="flex items-center justify-between border-b border-line bg-paper/40 px-5 py-3.5">
              <h2 className="font-display text-sm font-bold text-ink">
                Commercial Order History ({orders.length})
              </h2>
            </div>

            {orders.length === 0 ? (
              <p className="p-8 text-center text-xs text-text-muted">No commercial orders placed by this customer yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-line bg-paper/20 text-xs font-semibold uppercase tracking-wider text-ink/80">
                      <th className="py-3 pl-5 pr-4">Order Reference</th>
                      <th className="py-3 pr-4">Status</th>
                      <th className="py-3 pr-4">Date Placed</th>
                      <th className="py-3 pr-5 text-right">Order Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {orders.map((o) => (
                      <tr key={o.id} className="transition-colors hover:bg-paper/20">
                        <td className="py-3.5 pl-5 pr-4">
                          <Link href={`/orders/${o.id}`} className="font-mono text-xs font-bold text-ink hover:text-accent transition-colors">
                            {o.reference}
                          </Link>
                        </td>
                        <td className="py-3.5 pr-4">
                          <OrderStatusBadge status={o.status} />
                        </td>
                        <td className="py-3.5 pr-4 text-xs font-tabular text-text-muted">
                          {formatDateTime(o.createdAt)}
                        </td>
                        <td className="py-3.5 pr-5 text-right font-tabular text-sm font-bold text-ink">
                          {formatMoney(o.totalCents, o.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Agreed Custom Prices Card */}
          <div className="card-base overflow-hidden rounded-2xl shadow-xs p-5 space-y-4">
            <div className="border-b border-line/60 pb-3">
              <h2 className="font-display text-sm font-bold text-ink">Agreed Wholesale Pricing Tiers</h2>
              <p className="text-xs text-text-muted">Contracted unit rates locked exclusively for this account, overriding standard catalogue prices.</p>
            </div>

            {agreedPrices.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs font-semibold uppercase tracking-wider text-ink/80">
                      <th className="py-2.5 pr-4">Product Specification</th>
                      <th className="py-2.5 pr-4 text-right">Standard Catalog</th>
                      <th className="py-2.5 pr-4 text-right">Locked Rate</th>
                      {isOwner && <th className="py-2.5 w-8" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {agreedPrices.map((p) => (
                      <tr key={p.id}>
                        <td className="py-3 pr-4 text-ink font-semibold">
                          <span>{p.product.name}</span>
                          <span className="ml-2 font-mono text-xs text-text-muted">{p.product.sku}</span>
                        </td>
                        <td className="py-3 pr-4 text-right font-tabular text-xs text-text-muted">
                          {formatMoney(p.product.priceCents)}
                        </td>
                        <td className="py-3 pr-4 text-right font-tabular text-xs font-bold text-emerald-700">
                          {formatMoney(p.priceCents)}
                        </td>
                        {isOwner && (
                          <td className="py-3 text-right">
                            <form action={removePriceAction.bind(null, customer.id, p.productId)}>
                              <button type="submit" className="text-xs text-rose-600 hover:underline cursor-pointer">
                                Remove
                              </button>
                            </form>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {isOwner && (
              <div className="border-t border-line/60 pt-3">
                <AgreedPriceForm
                  customerId={customer.id}
                  products={products.map((p) => ({
                    id: p.id,
                    label: `${p.name}${p.variantAttributes ? ` (${Object.values(p.variantAttributes as Record<string, string>).join(" / ")})` : ""}`,
                    priceNaira: p.priceCents / 100,
                  }))}
                />
              </div>
            )}
          </div>

          {/* Returns & Refunds History */}
          {returns.length > 0 && (
            <div className="card-base overflow-hidden rounded-2xl shadow-xs p-5 space-y-4">
              <div className="border-b border-line/60 pb-3">
                <h2 className="font-display text-sm font-bold text-ink">Returns &amp; Restitution Records</h2>
                <p className="text-xs text-text-muted">Historical returned goods authorizations and issued credits.</p>
              </div>

              <div className="divide-y divide-line/60">
                {returns.map((r) => (
                  <div key={r.id} className="py-3 flex items-center justify-between text-xs">
                    <div>
                      <p className="font-mono font-bold text-ink">{r.reference}</p>
                      <p className="text-text-muted">Order {r.order.reference} · {r.reason}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-tabular font-bold text-ink">{formatMoney(r.refundCents, r.order.currency)}</p>
                      <div className="flex gap-1.5 mt-0.5 justify-end">
                        <ReturnStatusBadge status={r.status} />
                        <RefundStatusBadge status={r.refundStatus} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column (1 Col): Edit Profile, Addresses, Activity */}
        <div className="space-y-6">
          {/* Edit Profile Form Card */}
          <div className="card-base rounded-2xl p-5 shadow-xs space-y-3.5">
            <div className="border-b border-line/60 pb-2.5">
              <h3 className="font-display text-sm font-bold text-ink">Account Profile Specifications</h3>
            </div>
            <EditCustomerForm
              customerId={customer.id}
              name={customer.name}
              email={customer.email}
              notes={customer.notes}
            />
          </div>

          {/* Saved Addresses Card */}
          <div className="card-base rounded-2xl p-5 shadow-xs space-y-3.5">
            <div className="border-b border-line/60 pb-2.5">
              <h3 className="font-display text-sm font-bold text-ink">Delivery Addresses</h3>
            </div>

            {addresses.length > 0 && (
              <ul className="divide-y divide-line/60">
                {addresses.map((a) => (
                  <li key={a.id} className="py-2.5 flex justify-between items-start text-xs">
                    <div>
                      <p className="font-semibold text-ink">
                        {a.label ? `${a.label} · ` : ""}
                        {a.text}
                      </p>
                      {a.isDefault && (
                        <span className="inline-block mt-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 font-semibold px-2 py-0.5 text-xs">
                          Default Destination
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {!a.isDefault && (
                        <form action={setDefaultAddressAction.bind(null, customer.id, a.id)}>
                          <button type="submit" className="text-accent hover:underline cursor-pointer">
                            Make default
                          </button>
                        </form>
                      )}
                      <form action={removeAddressAction.bind(null, customer.id, a.id)}>
                        <button type="submit" className="text-rose-600 hover:underline cursor-pointer">
                          Delete
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="border-t border-line/60 pt-3">
              <AddAddressForm customerId={customer.id} />
            </div>
          </div>

          {/* Activity Log */}
          {activity.length > 0 && (
            <div className="card-base rounded-2xl p-5 shadow-xs">
              <div className="border-b border-line/60 pb-2.5 mb-3">
                <h3 className="font-display text-sm font-bold text-ink">Account Timeline</h3>
              </div>
              <div className="divide-y divide-line/60 text-xs">
                {activity.map((entry) => (
                  <div key={entry.id} className="py-2 flex justify-between">
                    <span className="font-medium text-ink">{ACTIVITY_LABEL[entry.action] ?? entry.action}</span>
                    <span className="font-tabular text-text-muted">{formatDateTime(entry.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
