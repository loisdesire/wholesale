import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getProductStock } from "@/lib/stock";
import { formatDateTime } from "@/lib/format";
import { EditProductForm } from "./edit-product-form";
import { StockMovementForm } from "./stock-movement-form";

const REASON_LABEL: Record<string, string> = {
  INITIAL_STOCK: "Opening balance",
  PURCHASE_RECEIVED: "Purchase received",
  SALE_RESERVED: "Sale reserved",
  SALE_FULFILLED: "Sale fulfilled",
  RESERVATION_RELEASED: "Reservation released",
  RETURN: "Customer return",
  DAMAGE: "Damaged / written off",
  MANUAL_ADJUSTMENT: "Manual adjustment",
};

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const organizationId = session!.user.organizationId;

  const product = await prisma.product.findFirst({
    where: { id, organizationId },
    include: { priceTiers: { orderBy: { minQuantity: "asc" } } },
  });
  if (!product) notFound();

  const [stock, movements] = await Promise.all([
    getProductStock(product.id),
    prisma.stockMovement.findMany({
      where: { productId: product.id },
      include: { createdBy: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const variant = product.variantAttributes as Record<string, string> | null;

  return (
    <div className="flex flex-col gap-10">
      <header>
        <Link href="/catalogue" className="text-sm text-text-muted hover:text-ink">
          ← Catalogue
        </Link>
        <div className="mt-2 flex items-baseline justify-between">
          <div>
            <h1 className="text-xl font-medium text-ink">{product.name}</h1>
            <p className="mt-1 font-tabular text-sm text-text-muted">
              {product.sku}
              {variant ? ` · ${Object.values(variant).join(" / ")}` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className={`font-tabular text-2xl font-medium ${stock === 0 ? "text-status-attention-fg" : "text-ink"}`}>
              {stock}
            </p>
            <p className="text-xs text-text-muted">
              {product.unit}
              {stock === 1 ? "" : "s"} in stock
            </p>
          </div>
        </div>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink">Product details</h2>
        <EditProductForm
          productId={product.id}
          defaultValues={{
            sku: product.sku,
            name: product.name,
            attributes: variant ?? undefined,
            priceNaira: product.priceCents / 100,
            costNaira: product.costCents ? product.costCents / 100 : undefined,
            moq: product.moq,
            unit: product.unit,
            active: product.active,
            priceTiers: product.priceTiers.map((t) => ({
              minQuantity: t.minQuantity,
              priceNaira: t.priceCents / 100,
            })),
          }}
        />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink">Record a stock movement</h2>
        <StockMovementForm productId={product.id} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink">Movement history</h2>
        {movements.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-text-muted">
            No movements recorded yet.
          </p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
                <th className="py-2 pr-4">When</th>
                <th className="py-2 pr-4">Reason</th>
                <th className="py-2 pr-4">Reference</th>
                <th className="py-2 pr-4">Note</th>
                <th className="py-2 pr-4">By</th>
                <th className="py-2 pr-4 text-right">Change</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id} className="border-b border-line last:border-0">
                  <td className="py-3 pr-4 text-xs text-text-muted">{formatDateTime(m.createdAt)}</td>
                  <td className="py-3 pr-4 text-ink">{REASON_LABEL[m.reason] ?? m.reason}</td>
                  <td className="py-3 pr-4 font-tabular text-text-muted">{m.reference ?? "—"}</td>
                  <td className="py-3 pr-4 max-w-xs truncate text-text-muted">{m.note ?? "—"}</td>
                  <td className="py-3 pr-4 text-text-muted">{m.createdBy?.name ?? "—"}</td>
                  <td
                    className={`py-3 pr-4 text-right font-tabular ${
                      m.quantityDelta < 0 ? "text-status-attention-fg" : "text-status-success-fg"
                    }`}
                  >
                    {m.quantityDelta > 0 ? "+" : ""}
                    {m.quantityDelta}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
