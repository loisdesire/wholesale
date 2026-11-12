import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { getStockByProduct } from "@/lib/stock";
import { formatDateTime, formatMoney } from "@/lib/format";
import { OrderStepper } from "@/components/order-stepper";
import { RefundStatusBadge, ReturnStatusBadge } from "@/components/status-badge";
import { getReturnableQuantities } from "@/lib/returns";
import { findDuplicateOrders } from "@/lib/orders";
import { listOrganizationMembers } from "@/lib/membership";
import { AssigneeControl } from "@/components/assignee-control";
import { Avatar } from "@/components/avatar";
import { removeOrderItemAction } from "../actions";
import { OrderActions } from "./order-actions";
import { OrderDetailsForm, QuantityForm } from "./order-edit-forms";
import { CloseShortForm, ShipForm } from "./fulfilment-ui";
import { AmendOrderForm } from "./amend-ui";
import { AddItemForm } from "./add-item-form";
import { RequestReturnForm, ReturnActions } from "./returns-ui";

const AUDIT_ACTION_LABEL: Record<string, string> = {
  ORDER_DRAFTED: "Order drafted",
  ORDER_CONFIRMED: "Order confirmed, stock reserved",
  PAYMENT_MARKED_PAID: "Marked as paid",
  PAYMENT_RECORDED: "Payment recorded",
  ORDER_FULFILLED: "Fully shipped — order fulfilled",
  ORDER_PARTIALLY_SHIPPED: "Part of the order shipped",
  ORDER_CLOSED_SHORT: "Closed short — unshipped items refunded",
  ORDER_AMENDED: "Order amended",
  ORDER_CANCELLED: "Order cancelled",
  ORDER_ITEM_QUANTITY_CHANGED: "Item quantity changed",
  ORDER_DETAILS_UPDATED: "Delivery address / notes updated",
  RETURN_REQUESTED: "Return requested",
  RETURN_APPROVED: "Return approved",
  RETURN_REJECTED: "Return rejected",
  RETURN_RECEIVED: "Returned goods received into stock",
  REFUND_PAID: "Refund paid to customer",
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
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <Link href="/orders" className="back-link self-start">
          ← Orders
        </Link>
        {/* The order "ticket": who, how much, where it is in its journey, and what can be done
            next — the four things someone opening an order needs before anything else. */}
        <div className="card overflow-hidden">
          <div className="flex flex-col gap-5 p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3.5">
                <Avatar name={order.customer.name ?? order.customer.phone} size="lg" />
                <div className="min-w-0">
                  <h1 className="font-mono text-sm font-medium text-text-muted">{order.reference}</h1>
                  <p className="truncate font-display text-2xl font-bold tracking-tight text-ink">
                    <Link href={`/customers/${order.customer.id}`} className="underline-offset-4 hover:underline">
                      {order.customer.name ?? "Unnamed"}
                    </Link>
                  </p>
                  <p className="mt-0.5 text-sm text-text-muted">
                    <span className="font-tabular">{order.customer.phone}</span>
                    {order.conversation && (
                      <>
                        {" · from "}
                        <Link href="/inbox" className="link">
                          conversation
                        </Link>
                      </>
                    )}
                  </p>
                </div>
              </div>
              <div className="sm:text-right">
                <p className="eyebrow">Order total</p>
                <p className="font-display text-4xl font-bold leading-tight tracking-tight text-ink">
                  {formatMoney(order.totalCents, order.currency)}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <OrderStepper status={order.status} />
              <div className="flex shrink-0 items-center gap-2 text-sm text-text-muted">
                Assigned to
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
          {["DRAFT", "CONFIRMED", "PAID", "PARTIALLY_FULFILLED"].includes(order.status) && (
            <div className="border-t border-line bg-paper/60 px-5 py-4 sm:px-6">
              <OrderActions
                orderId={order.id}
                status={order.status}
                isOwner={isOwner}
                duplicateOf={duplicates.map((d) => d.reference)}
              />
            </div>
          )}
        </div>
      </header>

      {order.status !== "DRAFT" && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="section-title">Payments</h2>
            <p className="font-tabular text-sm font-medium text-ink">
              {formatMoney(paidCents, order.currency)} of {formatMoney(order.totalCents, order.currency)}
              {paidCents > order.totalCents && (
                <span className="ml-2 rounded-full bg-status-attention-bg px-2 py-0.5 text-xs font-medium text-status-attention-fg">
                  Overpaid by {formatMoney(paidCents - order.totalCents, order.currency)}
                </span>
              )}
            </p>
          </div>
          <div className="mb-3 h-2 overflow-hidden rounded-full bg-line" aria-hidden="true">
            <div
              className={`h-full rounded-full ${paidCents >= order.totalCents ? "bg-status-success-fg" : "bg-accent"}`}
              style={{ width: `${order.totalCents > 0 ? Math.min(100, Math.round((paidCents / order.totalCents) * 100)) : 0}%` }}
            />
          </div>
          {order.payments.length === 0 ? (
            <p className="empty">
              No payments recorded yet.
            </p>
          ) : (
            <div className="card">
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr className="thead-row">
                      <th className="px-4 py-2">Method</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                      <th className="px-4 py-2">When</th>
                      <th className="px-4 py-2">Recorded by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.payments.map((p) => (
                      <tr key={p.id} className="trow">
                        <td className="px-4 py-3 text-ink">{p.method === "PROVIDER" ? "Paystack" : "Manual"}</td>
                        <td className="px-4 py-3 text-right font-tabular text-ink">{formatMoney(p.amountCents, p.currency)}</td>
                        <td className="px-4 py-3 text-xs text-text-muted">{formatDateTime(p.createdAt)}</td>
                        <td className="px-4 py-3 text-text-muted">{p.recordedBy?.name ?? (p.method === "PROVIDER" ? "Verified automatically" : "—")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="section-title mb-3">Items</h2>
        <div className="card">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr className="thead-row">
                  <th className="px-4 py-2">Product</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2 text-right">Unit price</th>
                  <th className="px-4 py-2 text-right">Line total</th>
                  {order.status === "DRAFT" && <th className="px-4 py-2" />}
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id} className="trow">
                    <td className="px-4 py-3 text-ink">
                      {item.product.name}
                      {item.variantLabel ? ` (${item.variantLabel})` : ""}
                      <span className="ml-2 font-mono text-xs text-text-muted">{item.product.sku}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-tabular text-ink">
                      {order.status === "DRAFT" ? (
                        <QuantityForm
                          orderId={order.id}
                          orderItemId={item.id}
                          quantity={item.quantity}
                          moq={item.product.moq}
                        />
                      ) : (
                        item.quantity
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-tabular text-text-muted">
                      {formatMoney(item.unitPriceCents, order.currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-tabular text-ink">
                      {formatMoney(item.unitPriceCents * item.quantity, order.currency)}
                    </td>
                    {order.status === "DRAFT" && (
                      <td className="px-4 py-3 text-right">
                        <form action={removeOrderItemAction.bind(null, order.id, item.id)}>
                          <button type="submit" className="text-xs text-status-attention-fg hover:underline">
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
          <div className="flex items-center justify-between border-t border-line bg-paper/60 px-[1.125rem] py-3.5">
            <span className="text-sm font-semibold text-ink">Total</span>
            <span className="font-tabular text-base font-bold text-ink">
              {formatMoney(order.totalCents, order.currency)}
            </span>
          </div>
        </div>
      </section>

      {order.status === "CONFIRMED" && (
        <section>
          <h2 className="section-title mb-3">Amend this order</h2>
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
        </section>
      )}

      {(canShip || shipments.length > 0) && (
        <section className="flex flex-col gap-4">
          <h2 className="section-title">Shipping</h2>

          {canShip && <ShipForm orderId={order.id} lines={shipLines} />}

          {order.status === "PARTIALLY_FULFILLED" &&
            (isOwner ? (
              <CloseShortForm
                orderId={order.id}
                unshippedLabel={`${unshippedUnits} unit${unshippedUnits === 1 ? "" : "s"}, ${formatMoney(unshippedValue, order.currency)}`}
              />
            ) : (
              <p className="text-sm text-text-muted">Closing the rest of the order short means a refund — only an owner can do it.</p>
            ))}

          {shipments.length > 0 && (
            <div className="card divide-y divide-line">
              {shipments.map((sh) => (
                <div key={sh.id} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
                  <div>
                    <p className="font-tabular text-ink">{sh.reference}</p>
                    <p className="mt-1 text-text-muted">
                      {sh.items
                        .map((it) => `${it.quantity} × ${it.orderItem.product.name}${it.orderItem.variantLabel ? ` (${it.orderItem.variantLabel})` : ""}`)
                        .join(", ")}
                    </p>
                  </div>
                  <div className="text-right text-xs text-text-muted">
                    <p>{formatDateTime(sh.createdAt)}</p>
                    {(sh.carrier || sh.trackingReference) && (
                      <p className="mt-1">
                        {sh.carrier ?? ""}
                        {sh.carrier && sh.trackingReference ? " · " : ""}
                        <span className="font-tabular">{sh.trackingReference ?? ""}</span>
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="section-title mb-3">Delivery &amp; notes</h2>
        <OrderDetailsForm
          orderId={order.id}
          notes={order.notes}
          deliveryAddress={order.deliveryAddress}
          dueAt={order.dueAt}
          addressOptions={order.customer.addresses}
          editable={order.status !== "FULFILLED" && order.status !== "CANCELLED"}
        />
      </section>

      {order.status === "DRAFT" && (
        <section>
          <h2 className="section-title mb-3">Add an item</h2>
          <AddItemForm orderId={order.id} products={productOptions} />
        </section>
      )}

      {(returns.length > 0 || canRequestReturn) && (
        <section className="flex flex-col gap-4">
          <h2 className="section-title">Returns &amp; refunds</h2>

          {returns.map((ret) => (
            <div key={ret.id} className="flex flex-col gap-4 card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-tabular text-sm font-medium text-ink">{ret.reference}</p>
                  <p className="mt-1 text-sm text-text-muted">
                    {ret.reason} · requested by {ret.requestedBy?.name ?? "—"} · {formatDateTime(ret.createdAt)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <p className="font-tabular text-lg font-medium text-ink">
                    {formatMoney(ret.refundCents, order.currency)}
                  </p>
                  {ret.refundCents < ret.valueCents && (
                    <p className="text-xs text-text-muted">
                      partial — goods worth {formatMoney(ret.valueCents, order.currency)}
                    </p>
                  )}
                  <div className="flex gap-2">
                    {ret.kind === "RETURN" && <ReturnStatusBadge status={ret.status} />}
                    {ret.status !== "REJECTED" && ret.status !== "REQUESTED" && (
                      <RefundStatusBadge status={ret.refundStatus} />
                    )}
                  </div>
                </div>
              </div>

              <ul className="divide-y divide-line text-sm">
                {ret.items.map((item) => (
                  <li key={item.id} className="flex items-center justify-between py-2">
                    <span className="text-ink">
                      {item.quantity} × {item.orderItem.product.name}
                      {item.orderItem.variantLabel ? ` (${item.orderItem.variantLabel})` : ""}
                    </span>
                    <span className="text-xs text-text-muted">
                      {ret.kind !== "RETURN" ? "Not shipped" : item.condition === "DAMAGED" ? "Damaged" : "Resellable"} ·{" "}
                      {formatMoney(item.quantity * item.orderItem.unitPriceCents, order.currency)} at the order price
                    </span>
                  </li>
                ))}
              </ul>

              {ret.decidedAt && (
                <p className="text-xs text-text-muted">
                  {ret.status === "REJECTED" ? "Rejected" : "Approved"} by {ret.decidedBy?.name ?? "—"} ·{" "}
                  {formatDateTime(ret.decidedAt)}
                  {ret.decisionNote ? ` · “${ret.decisionNote}”` : ""}
                </p>
              )}
              {ret.refundedAt && (
                <p className="text-xs text-text-muted">
                  Refund paid {formatDateTime(ret.refundedAt)}
                  {ret.refundNote ? ` · ${ret.refundNote}` : ""}
                </p>
              )}

              <div className="flex items-center justify-between gap-4">
                <ReturnActions
                  returnId={ret.id}
                  status={ret.status}
                  refundStatus={ret.refundStatus}
                  isOwner={isOwner}
                  valueNaira={ret.valueCents / 100}
                />
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  Assigned to
                  <AssigneeControl
                    kind="return"
                    id={ret.id}
                    currentAssigneeId={ret.assignedToId}
                    members={members}
                    isOwner={isOwner}
                    currentUserId={session!.user.id}
                  />
                </div>
              </div>
            </div>
          ))}

          {canRequestReturn && (
            <div>
              <h3 className="mb-2 text-sm text-text-muted">Request a return</h3>
              <RequestReturnForm orderId={order.id} lines={returnableLines} />
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="section-title mb-3">History</h2>
        {auditLog.length === 0 ? (
          <p className="text-sm text-text-muted">No history yet.</p>
        ) : (
          <ol className="card relative flex flex-col gap-0 px-5 py-4">
            {auditLog.map((entry, i) => (
              <li key={entry.id} className="relative flex gap-3.5 pb-4 text-sm last:pb-0">
                {i < auditLog.length - 1 && <span aria-hidden="true" className="absolute left-[5px] top-4 h-full w-px bg-line" />}
                <span aria-hidden="true" className={`relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 ${i === 0 ? "border-accent bg-accent" : "border-line-strong bg-surface"}`} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                  <span className="font-medium text-ink">{AUDIT_ACTION_LABEL[entry.action] ?? entry.action}</span>
                  <span className="shrink-0 text-xs text-text-muted">
                    {entry.actor?.name ?? "System"} · {formatDateTime(entry.createdAt)}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
