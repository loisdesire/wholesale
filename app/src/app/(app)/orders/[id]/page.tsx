import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStockByProduct } from "@/lib/stock";
import { formatDateTime, formatMoney } from "@/lib/format";
import { OrderStepper } from "@/components/order-stepper";
import { removeOrderItemAction } from "../actions";
import { OrderActions } from "./order-actions";
import { AddItemForm } from "./add-item-form";

const AUDIT_ACTION_LABEL: Record<string, string> = {
  ORDER_DRAFTED: "Order drafted",
  ORDER_CONFIRMED: "Order confirmed, stock reserved",
  PAYMENT_MARKED_PAID: "Marked as paid",
  ORDER_FULFILLED: "Marked as fulfilled",
  ORDER_CANCELLED: "Order cancelled",
};

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const organizationId = session!.user.organizationId;

  const order = await prisma.order.findFirst({
    where: { id, organizationId },
    include: {
      customer: true,
      conversation: true,
      items: { include: { product: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) notFound();

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
              {order.customer.name ?? "Unnamed"} · {order.customer.phone}
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
        <OrderActions orderId={order.id} status={order.status} />
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
                  <td className="px-4 py-3 text-right font-tabular text-ink">{item.quantity}</td>
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

      {order.status === "DRAFT" && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-ink">Add an item</h2>
          <AddItemForm orderId={order.id} products={productOptions} />
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
