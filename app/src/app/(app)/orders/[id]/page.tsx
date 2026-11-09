import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { getStockByProduct } from "@/lib/stock";
import { formatDateTime, formatMoney } from "@/lib/format";
import { OrderStepper } from "@/components/order-stepper";
import { OrderStatusBadge, RefundStatusBadge, ReturnStatusBadge } from "@/components/status-badge";
import { getReturnableQuantities } from "@/lib/returns";
import { findDuplicateOrders } from "@/lib/orders";
import { listOrganizationMembers } from "@/lib/membership";
import { AssigneeControl } from "@/components/assignee-control";
import { removeOrderItemAction } from "../actions";
import { OrderActions } from "./order-actions";
import { OrderDetailsForm, QuantityForm } from "./order-edit-forms";
import { CloseShortForm, ShipForm } from "./fulfilment-ui";
import { AmendOrderForm } from "./amend-ui";
import { AddItemForm } from "./add-item-form";
import { RequestReturnForm, ReturnActions } from "./returns-ui";
import { ArrowLeft, MessageSquare, ExternalLink } from "lucide-react";

const AUDIT_ACTION_LABEL: Record<string, string> = {
  ORDER_DRAFTED: "Order drafted",
  ORDER_CONFIRMED: "Order confirmed, stock reserved",
  PAYMENT_MARKED_PAID: "Payment recorded as settled",
  PAYMENT_RECORDED: "Payment received",
  ORDER_FULFILLED: "Fully dispatched — order fulfilled",
  ORDER_PARTIALLY_SHIPPED: "Partial dispatch recorded",
  ORDER_CLOSED_SHORT: "Closed short — unshipped items voided/refunded",
  ORDER_AMENDED: "Order amended",
  ORDER_CANCELLED: "Order cancelled",
  ORDER_ITEM_QUANTITY_CHANGED: "Item quantity adjusted",
  ORDER_DETAILS_UPDATED: "Delivery details / instructions updated",
  RETURN_REQUESTED: "Return requested",
  RETURN_APPROVED: "Return approved",
  RETURN_REJECTED: "Return rejected",
  RETURN_RECEIVED: "Returned stock received into inventory",
  REFUND_PAID: "Refund settled to customer",
};

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const organizationId = session!.user.organizationId;
  const db = tenantDb(organizationId);

  const order = await db.order.findFirst({
    where: { id, organizationId },
    include: {
      customer: { include: { addresses: { orderBy: { createdAt: "asc" } } } },
      conversation: true,
      items: { include: { product: true }, orderBy: { createdAt: "asc" } },
      payments: { include: { recordedBy: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) notFound();

  const paidCents = order.payments.reduce((sum, p) => sum + p.amountCents, 0);
  const totalUnits = order.items.reduce((acc, i) => acc + i.quantity, 0);

  const isOwner = session!.user.role === "OWNER";
  const duplicates =
    order.status === "DRAFT" ? await findDuplicateOrders(organizationId, order.id, db) : [];
  const [returns, returnable] = await Promise.all([
    db.orderReturn.findMany({
      where: { orderId: order.id, organizationId },
      include: {
        requestedBy: true,
        decidedBy: true,
        items: { include: { orderItem: { include: { product: true } } } },
      },
      orderBy: { createdAt: "asc" },
    }),
    getReturnableQuantities(order.id, db),
  ]);
  const returnableLines = order.items.map((item) => ({
    orderItemId: item.id,
    label: `${item.product.name}${item.variantLabel ? ` (${item.variantLabel})` : ""}`,
    sku: item.product.sku,
    returnable: returnable.get(item.id) ?? 0,
    unit: item.product.unit,
  }));
  const canRequestReturn =
    (order.status === "FULFILLED" || order.status === "PARTIALLY_FULFILLED") &&
    returnableLines.some((l) => l.returnable > 0);

  const shipments = await db.shipment.findMany({
    where: { orderId: order.id, organizationId },
    include: { items: { include: { orderItem: { include: { product: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const shippedByItem = new Map<string, number>();
  for (const sh of shipments) for (const it of sh.items) shippedByItem.set(it.orderItemId, (shippedByItem.get(it.orderItemId) ?? 0) + it.quantity);
  const shipLines = order.items.map((item) => ({
    orderItemId: item.id,
    label: `${item.product.name}${item.variantLabel ? ` (${item.variantLabel})` : ""}`,
    sku: item.product.sku,
    ordered: item.quantity,
    shipped: shippedByItem.get(item.id) ?? 0,
    unit: item.product.unit,
  }));
  const shippedUnits = shipLines.reduce((sum, l) => sum + l.shipped, 0);
  const unshippedUnits = shipLines.reduce((sum, l) => sum + (l.ordered - l.shipped), 0);
  const unshippedValue = order.items.reduce(
    (sum, item) => sum + (item.quantity - (shippedByItem.get(item.id) ?? 0)) * item.unitPriceCents,
    0
  );
  const canShip = order.status === "PAID" || order.status === "PARTIALLY_FULFILLED";

  const [auditLog, activeProducts, stockMap, members] = await Promise.all([
    db.auditLog.findMany({
      where: { organizationId, entity: "Order", entityId: order.id },
      include: { actor: true },
      orderBy: { createdAt: "asc" },
    }),
    order.status === "DRAFT" || order.status === "CONFIRMED"
      ? db.product.findMany({ where: { organizationId, active: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    order.status === "DRAFT" ? getStockByProduct(organizationId, db) : Promise.resolve(new Map()),
    listOrganizationMembers(organizationId),
  ]);

  const productOptions = activeProducts.map((p) => {
    const variant = p.variantAttributes as Record<string, string> | null;
    return {
      id: p.id,
      name: p.name,
      variantLabel: variant ? Object.values(variant).join(" / ") : null,
      priceCents: p.priceCents,
      moq: p.moq,
      stock: stockMap.get(p.id) ?? 0,
    };
  });

  return (
    <div className="flex flex-col gap-6 pb-16">
      {/* Top Order Command Header */}
      <header className="card-base flex flex-col gap-5 rounded-2xl p-5 sm:p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/orders"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-paper/60 text-ink hover:bg-paper transition-colors active:scale-95"
              title="Return to order ledger"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="font-mono text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                  {order.reference}
                </h1>
                <OrderStatusBadge status={order.status} />
              </div>
              <p className="mt-0.5 text-xs text-text-muted">
                Created on {formatDateTime(order.createdAt)} · {totalUnits} total units
              </p>
            </div>
          </div>

          {/* Value & Assignee Bar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-baseline gap-1.5 rounded-xl border border-line bg-paper/40 px-3.5 py-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink/80">Total</span>
              <span className="font-tabular text-lg font-bold text-ink">
                {formatMoney(order.totalCents, order.currency)}
              </span>
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-line bg-paper/40 px-3 py-1.5 text-xs text-text-muted">
              <span className="font-semibold text-ink">Assigned:</span>
              <AssigneeControl
                kind="order"
                id={order.id}
                currentAssigneeId={order.assignedToId}
                members={members}
                isOwner={isOwner}
                currentUserId={session!.user.id}
              />
            </div>
          </div>
        </div>

        {/* Stepper & Operational Action Controls */}
        <div className="border-t border-line/60 pt-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <OrderStepper status={order.status} />
          <OrderActions
            orderId={order.id}
            status={order.status}
            isOwner={isOwner}
            duplicateOf={duplicates.map((d) => d.reference)}
          />
        </div>
      </header>

      {/* Main 2-Column Trade Workspace */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column (2 Cols): Line items, Shipments, Returns, History */}
        <div className="lg:col-span-2 space-y-6">
          {/* Order Items Table Card */}
          <div className="card-base overflow-hidden rounded-2xl shadow-xs">
            <div className="flex items-center justify-between border-b border-line bg-paper/40 px-5 py-3.5">
              <h2 className="font-display text-sm font-bold text-ink">
                Line Items ({totalUnits} units)
              </h2>
              <span className="font-tabular text-sm font-bold text-ink">
                {formatMoney(order.totalCents, order.currency)}
              </span>
            </div>

            {/* Mobile Card List (< 640px) */}
            <div className="block sm:hidden divide-y divide-line/60">
              {order.items.map((item) => (
                <div key={item.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink text-sm">{item.product.name}</p>
                      {item.variantLabel && (
                        <p className="text-xs text-text-muted">{item.variantLabel}</p>
                      )}
                      <p className="font-mono text-xs text-text-muted font-medium">{item.product.sku}</p>
                    </div>

                    {order.status === "DRAFT" && (
                      <form action={removeOrderItemAction.bind(null, order.id, item.id)}>
                        <button
                          type="submit"
                          title="Remove item"
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-text-muted/60 hover:text-rose-600 transition-colors"
                        >
                          ✕
                        </button>
                      </form>
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t border-line/50 pt-2 text-xs">
                    <div className="font-tabular text-text-muted">
                      {order.status === "DRAFT" ? (
                        <QuantityForm
                          orderId={order.id}
                          orderItemId={item.id}
                          quantity={item.quantity}
                          moq={item.product.moq}
                        />
                      ) : (
                        <span>{item.quantity} {item.product.unit}{item.quantity === 1 ? "" : "s"} × {formatMoney(item.unitPriceCents, order.currency)}</span>
                      )}
                    </div>
                    <span className="font-tabular font-bold text-sm text-ink">
                      {formatMoney(item.quantity * item.unitPriceCents, order.currency)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table (>= 640px) */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line bg-paper/20 text-xs font-semibold uppercase tracking-wider text-ink/80">
                    <th className="py-3 pl-5 pr-4">Product Specification</th>
                    <th className="py-3 pr-4 text-right">Quantity</th>
                    <th className="py-3 pr-4 text-right">Unit Price</th>
                    <th className="py-3 pr-5 text-right">Subtotal</th>
                    {order.status === "DRAFT" && <th className="py-3 pr-4 w-8" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {order.items.map((item) => (
                    <tr key={item.id} className="transition-colors hover:bg-paper/20">
                      <td className="py-3.5 pl-5 pr-4">
                        <p className="font-semibold text-ink">{item.product.name}</p>
                        {item.variantLabel && (
                          <p className="text-xs text-text-muted">{item.variantLabel}</p>
                        )}
                        <p className="font-mono text-xs text-text-muted font-medium">{item.product.sku}</p>
                      </td>
                      <td className="py-3.5 pr-4 text-right font-tabular text-sm font-semibold text-ink">
                        {order.status === "DRAFT" ? (
                          <QuantityForm
                            orderId={order.id}
                            orderItemId={item.id}
                            quantity={item.quantity}
                            moq={item.product.moq}
                          />
                        ) : (
                          `${item.quantity} ${item.product.unit}`
                        )}
                      </td>
                      <td className="py-3.5 pr-4 text-right font-tabular text-sm text-text-muted">
                        {formatMoney(item.unitPriceCents, order.currency)}
                      </td>
                      <td className="py-3.5 pr-5 text-right font-tabular text-sm font-bold text-ink">
                        {formatMoney(item.quantity * item.unitPriceCents, order.currency)}
                      </td>
                      {order.status === "DRAFT" && (
                        <td className="py-3.5 pr-4 text-right">
                          <form action={removeOrderItemAction.bind(null, order.id, item.id)}>
                            <button
                              type="submit"
                              title="Remove item"
                              className="text-xs text-text-muted/60 hover:text-rose-600 transition-colors cursor-pointer"
                            >
                              ✕
                            </button>
                          </form>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Add Item form if Draft */}
            {order.status === "DRAFT" && (
              <div className="border-t border-line bg-paper/20 p-4">
                <AddItemForm orderId={order.id} products={productOptions} />
              </div>
            )}

            {/* Amend Form if Confirmed */}
            {order.status === "CONFIRMED" && (
              <div className="border-t border-line bg-paper/20 p-4">
                <AmendOrderForm
                  orderId={order.id}
                  lines={order.items.map((item) => ({
                    orderItemId: item.id,
                    label: `${item.product.name}${item.variantLabel ? ` (${item.variantLabel})` : ""}`,
                    sku: item.product.sku,
                    quantity: item.quantity,
                    moq: item.product.moq,
                  }))}
                  products={activeProducts.map((p) => {
                    const variant = p.variantAttributes as Record<string, string> | null;
                    return { id: p.id, label: `${p.name}${variant ? ` (${Object.values(variant).join(" / ")})` : ""}` };
                  })}
                />
              </div>
            )}
          </div>

          {/* Fulfilment & Shipments Section */}
          {(canShip || shipments.length > 0) && (
            <div className="card-base rounded-2xl p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between border-b border-line/60 pb-3">
                <div>
                  <h2 className="font-display text-sm font-bold text-ink">Fulfillment &amp; Dispatch</h2>
                  <p className="text-xs text-text-muted">Waybills, carrier assignments, and shipping manifests.</p>
                </div>
                <span className="font-tabular text-xs font-semibold text-text-muted">
                  {unshippedUnits === 0 ? "All units dispatched" : `${shippedUnits} shipped · ${unshippedUnits} pending`}
                </span>
              </div>

              {canShip && <ShipForm orderId={order.id} lines={shipLines} />}

              {order.status === "PARTIALLY_FULFILLED" &&
                (isOwner ? (
                  <CloseShortForm
                    orderId={order.id}
                    unshippedLabel={`${unshippedUnits} unit${unshippedUnits === 1 ? "" : "s"}, ${formatMoney(unshippedValue, order.currency)}`}
                  />
                ) : (
                  <p className="text-xs text-text-muted">Closing remaining unshipped units short requires owner permission.</p>
                ))}

              {shipments.length > 0 && (
                <div className="divide-y divide-line/70 border-t border-line/60 pt-2">
                  {shipments.map((sh) => (
                    <div key={sh.id} className="py-3 text-xs flex flex-col gap-1.5">
                      <div className="flex justify-between font-semibold text-ink">
                        <span className="font-mono">{sh.reference} {sh.carrier ? `· ${sh.carrier}` : ""}</span>
                        <span className="font-tabular font-normal text-text-muted">{formatDateTime(sh.createdAt)}</span>
                      </div>
                      {sh.trackingReference && (
                        <p className="font-tabular text-text-muted">Tracking: <strong className="text-ink">{sh.trackingReference}</strong></p>
                      )}
                      <div className="flex flex-wrap gap-2 pt-0.5">
                        {sh.items.map((it) => (
                          <span key={it.id} className="rounded-md border border-line bg-paper/60 px-2 py-0.5 font-medium text-ink">
                            {it.quantity} × {it.orderItem.product.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Returns & Adjustments Section */}
          {(returns.length > 0 || canRequestReturn) && (
            <div className="card-base rounded-2xl p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between border-b border-line/60 pb-3">
                <div>
                  <h2 className="font-display text-sm font-bold text-ink">Returns &amp; Restitution</h2>
                  <p className="text-xs text-text-muted">Inventory intake and customer refund tracking.</p>
                </div>
              </div>

              {returns.map((ret) => (
                <div key={ret.id} className="rounded-xl border border-line bg-paper/30 p-4 space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-mono text-sm font-bold text-ink">{ret.reference}</p>
                      <p className="text-xs text-text-muted">
                        {ret.reason} · requested by {ret.requestedBy?.name ?? "—"} · {formatDateTime(ret.createdAt)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-tabular text-sm font-bold text-ink">
                        {formatMoney(ret.refundCents, order.currency)}
                      </p>
                      <div className="mt-1 flex gap-1 justify-end">
                        {ret.kind === "RETURN" && <ReturnStatusBadge status={ret.status} />}
                        {ret.status !== "REJECTED" && ret.status !== "REQUESTED" && (
                          <RefundStatusBadge status={ret.refundStatus} />
                        )}
                      </div>
                    </div>
                  </div>

                  <ReturnActions
                    returnId={ret.id}
                    status={ret.status}
                    refundStatus={ret.refundStatus}
                    isOwner={isOwner}
                    valueNaira={ret.valueCents / 100}
                  />
                </div>
              ))}

              {canRequestReturn && (
                <div className="border-t border-line/60 pt-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Submit Return Request</h3>
                  <RequestReturnForm orderId={order.id} lines={returnableLines} />
                </div>
              )}
            </div>
          )}

          {/* Audit History Log */}
          <div className="card-base rounded-2xl p-5 shadow-xs">
            <div className="border-b border-line/60 pb-3 mb-3">
              <h2 className="font-display text-sm font-bold text-ink">Audit Trail</h2>
              <p className="text-xs text-text-muted">Immutable event record for compliance and accountability.</p>
            </div>
            {auditLog.length === 0 ? (
              <p className="text-xs text-text-muted">No audit events recorded yet.</p>
            ) : (
              <div className="divide-y divide-line/60 text-xs">
                {auditLog.map((entry) => (
                  <div key={entry.id} className="flex justify-between py-2 text-ink">
                    <span className="font-medium">{AUDIT_ACTION_LABEL[entry.action] ?? entry.action}</span>
                    <span className="font-tabular text-text-muted">
                      {entry.actor?.name ?? "System"} · {formatDateTime(entry.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column (1 Col): Customer, Delivery Details, Payments */}
        <div className="space-y-6">
          {/* Customer Profile Card */}
          <div className="card-base rounded-2xl p-5 space-y-3.5 shadow-xs">
            <div className="flex items-center justify-between border-b border-line/60 pb-2">
              <h3 className="font-display text-sm font-bold text-ink">Customer Account</h3>
              <Link
                href={`/customers/${order.customer.id}`}
                className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
              >
                <span>View Full Profile</span>
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between items-baseline">
                <span className="text-text-muted">Name</span>
                <span className="font-bold text-ink">{order.customer.name ?? "Unnamed"}</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-text-muted">Phone</span>
                <span className="font-tabular font-medium text-ink">{order.customer.phone}</span>
              </div>
              {order.conversation && (
                <div className="flex justify-between items-center border-t border-line/60 pt-2">
                  <span className="text-text-muted">WhatsApp Thread</span>
                  <Link
                    href={`/inbox/${order.conversation.id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-500/20 transition-colors"
                  >
                    <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Open Chat</span>
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* Delivery Details Card */}
          <div className="card-base rounded-2xl p-5 space-y-3 shadow-xs">
            <div className="border-b border-line/60 pb-2">
              <h3 className="font-display text-sm font-bold text-ink">Delivery Logistics &amp; Instructions</h3>
            </div>
            <OrderDetailsForm
              orderId={order.id}
              notes={order.notes}
              deliveryAddress={order.deliveryAddress}
              dueAt={order.dueAt}
              addressOptions={order.customer.addresses}
              editable={order.status !== "FULFILLED" && order.status !== "CANCELLED"}
            />
          </div>

          {/* Payment Summary Card */}
          {order.status !== "DRAFT" && (
            <div className="card-base rounded-2xl p-5 space-y-3 shadow-xs">
              <div className="flex items-center justify-between border-b border-line/60 pb-2">
                <h3 className="font-display text-sm font-bold text-ink">Settlement Ledger</h3>
                <span className="font-tabular text-xs font-bold text-ink">
                  {formatMoney(paidCents, order.currency)}
                </span>
              </div>

              {paidCents > order.totalCents && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-2.5 text-xs font-semibold text-amber-900">
                  Overpaid balance: {formatMoney(paidCents - order.totalCents, order.currency)}
                </div>
              )}

              {order.payments.length === 0 ? (
                <p className="text-xs text-text-muted">No payments recorded yet.</p>
              ) : (
                <div className="divide-y divide-line/60 text-xs">
                  {order.payments.map((p) => (
                    <div key={p.id} className="py-2.5 flex justify-between items-baseline">
                      <div>
                        <p className="font-semibold text-ink">
                          {p.method === "PROVIDER" ? "Paystack Card / Transfer" : "Direct Bank Transfer"}
                        </p>
                        <p className="font-tabular text-xs text-text-muted">{formatDateTime(p.createdAt)}</p>
                      </div>
                      <span className="font-tabular text-sm font-bold text-ink">
                        {formatMoney(p.amountCents, p.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
