import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStockByProduct } from "@/lib/stock";
import { formatDateTime, formatMoney } from "@/lib/format";
import { OrderStepper } from "@/components/order-stepper";
import { RefundStatusBadge, ReturnStatusBadge } from "@/components/status-badge";
import { getReturnableQuantities } from "@/lib/returns";
import { findDuplicateOrders } from "@/lib/orders";
import { removeOrderItemAction } from "../actions";
import { OrderActions } from "./order-actions";
import { OrderDetailsForm, QuantityForm } from "./order-edit-forms";
import { AddItemForm } from "./add-item-form";
import { RequestReturnForm, ReturnActions } from "./returns-ui";

const AUDIT_ACTION_LABEL: Record<string, string> = {
  ORDER_DRAFTED: "Order drafted",
  ORDER_CONFIRMED: "Order confirmed, stock reserved",
  PAYMENT_MARKED_PAID: "Marked as paid",
  ORDER_FULFILLED: "Marked as fulfilled",
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

  const order = await prisma.order.findFirst({
    where: { id, organizationId },
    include: {
      customer: { include: { addresses: { orderBy: { createdAt: "asc" } } } },
      conversation: true,
      items: { include: { product: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) notFound();

  const isOwner = session!.user.role === "OWNER";
  const duplicates =
    order.status === "DRAFT" ? await findDuplicateOrders(organizationId, order.id) : [];
  const [returns, returnable] = await Promise.all([
    prisma.orderReturn.findMany({
      where: { orderId: order.id, organizationId },
      include: {
        requestedBy: true,
        decidedBy: true,
        items: { include: { orderItem: { include: { product: true } } } },
      },
      orderBy: { createdAt: "asc" },
    }),
    getReturnableQuantities(order.id),
  ]);
  const returnableLines = order.items.map((item) => ({
    orderItemId: item.id,
    label: `${item.product.name}${item.variantLabel ? ` (${item.variantLabel})` : ""}`,
    sku: item.product.sku,
    returnable: returnable.get(item.id) ?? 0,
    unit: item.product.unit,
  }));
  const canRequestReturn = order.status === "FULFILLED" && returnableLines.some((l) => l.returnable > 0);

  const [auditLog, activeProducts, stockMap] = await Promise.all([
    prisma.auditLog.findMany({
      where: { organizationId, entity: "Order", entityId: order.id },
      include: { actor: true },
      orderBy: { createdAt: "asc" },
    }),
    order.status === "DRAFT"
      ? prisma.product.findMany({ where: { organizationId, active: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    order.status === "DRAFT" ? getStockByProduct(organizationId) : Promise.resolve(new Map()),
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
    <div className="flex flex-col gap-10">
      <header>
        <Link href="/orders" className="text-sm text-text-muted hover:text-ink">
          ← Orders
        </Link>
        <div className="mt-2 flex items-start justify-between">
          <div>
            <h1 className="font-tabular text-xl font-medium text-ink">{order.reference}</h1>
            <p className="mt-1 text-sm text-text-muted">
              <Link href={`/customers/${order.customer.id}`} className="underline-offset-2 hover:underline">
                {order.customer.name ?? "Unnamed"}
              </Link>{" "}
              · {order.customer.phone}
              {order.conversation && (
                <>
                  {" · from "}
                  <Link href="/inbox" className="underline underline-offset-2 hover:text-ink">
                    conversation
                  </Link>
                </>
              )}
            </p>
          </div>
          <p className="font-tabular text-2xl font-medium text-ink">
            {formatMoney(order.totalCents, order.currency)}
          </p>
        </div>
        <div className="mt-4">
          <OrderStepper status={order.status} />
        </div>
      </header>

      <section>
        <OrderActions
          orderId={order.id}
          status={order.status}
          isOwner={isOwner}
          duplicateOf={duplicates.map((d) => d.reference)}
        />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink">Items</h2>
        <div className="rounded-md border border-line bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
                <th className="px-4 py-2">Product</th>
                <th className="px-4 py-2 text-right">Qty</th>
                <th className="px-4 py-2 text-right">Unit price</th>
                <th className="px-4 py-2 text-right">Line total</th>
                {order.status === "DRAFT" && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 text-ink">
                    {item.product.name}
                    {item.variantLabel ? ` (${item.variantLabel})` : ""}
                    <span className="ml-2 font-tabular text-xs text-text-muted">{item.product.sku}</span>
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
          <div className="flex items-center justify-between border-t border-line px-4 py-3">
            <span className="text-sm font-medium text-ink">Total</span>
            <span className="font-tabular text-sm font-medium text-ink">
              {formatMoney(order.totalCents, order.currency)}
            </span>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink">Delivery &amp; notes</h2>
        <OrderDetailsForm
          orderId={order.id}
          notes={order.notes}
          deliveryAddress={order.deliveryAddress}
          addressOptions={order.customer.addresses}
          editable={order.status !== "FULFILLED" && order.status !== "CANCELLED"}
        />
      </section>

      {order.status === "DRAFT" && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-ink">Add an item</h2>
          <AddItemForm orderId={order.id} products={productOptions} />
        </section>
      )}

      {(returns.length > 0 || canRequestReturn) && (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium text-ink">Returns &amp; refunds</h2>

          {returns.map((ret) => (
            <div key={ret.id} className="flex flex-col gap-4 rounded-md border border-line bg-surface p-4">
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
                      {ret.kind === "CANCELLATION" ? "Not shipped" : item.condition === "DAMAGED" ? "Damaged" : "Resellable"} ·{" "}
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

              <ReturnActions
                returnId={ret.id}
                status={ret.status}
                refundStatus={ret.refundStatus}
                isOwner={isOwner}
              />
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
        <h2 className="mb-3 text-sm font-medium text-ink">History</h2>
        {auditLog.length === 0 ? (
          <p className="text-sm text-text-muted">No history yet.</p>
        ) : (
          <div className="divide-y divide-line rounded-md border border-line bg-surface">
            {auditLog.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-ink">{AUDIT_ACTION_LABEL[entry.action] ?? entry.action}</span>
                <span className="text-xs text-text-muted">
                  {entry.actor?.name ?? "System"} · {formatDateTime(entry.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
