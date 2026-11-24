import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { getStockBreakdown } from "@/lib/stock";
import { formatDateTime, formatMoney } from "@/lib/format";
import { EditProductForm } from "./edit-product-form";
import { StockMovementForm } from "./stock-movement-form";
import { ProductImages } from "./product-images";

const REASON_LABEL: Record<string, string> = {
  INITIAL_STOCK: "Opening balance",
  PURCHASE_RECEIVED: "Purchase received",
  SALE_RESERVED: "Sale reserved",
  SALE_FULFILLED: "Sale fulfilled",
  RESERVATION_RELEASED: "Reservation released",
  RETURN: "Customer return",
  RETURN_DAMAGED: "Customer return (damaged)",
  DAMAGE: "Set aside as damaged",
  DAMAGE_WRITTEN_OFF: "Damaged stock written off",
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
  const db = tenantDb(organizationId);

  const product = await db.product.findFirst({
    where: { id, organizationId },
    include: {
      priceTiers: { orderBy: { minQuantity: "asc" } },
      images: { orderBy: { position: "asc" }, select: { id: true } },
    },
  });
  if (!product) notFound();

  const [figures, movements] = await Promise.all([
    getStockBreakdown(product.id, db),
    db.stockMovement.findMany({
      where: { productId: product.id },
      include: { createdBy: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const variant = product.variantAttributes as Record<string, string> | null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <Link href="/catalogue" className="back-link self-start">
          ← Catalogue
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="page-title">{product.name}</h1>
          <p className="text-sm text-text-muted">
            <span className="font-mono text-xs">{product.sku}</span>
            {variant ? ` · ${Object.values(variant).join(" / ")}` : ""}
            {" · "}
            <span className="font-tabular">{formatMoney(product.priceCents, product.currency)}</span> per {product.unit}
          </p>
        </div>

        {/* Stock at a glance. "Available" is the only figure a customer can be promised, so it
            leads; the bar shows how the units on hand split into available / reserved / damaged. */}
        <div className="grid gap-4 rounded-2xl bg-ink p-5 text-white sm:grid-cols-[auto_1fr] sm:items-center sm:gap-8 sm:p-6">
          <div>
            <p className="text-xs font-medium text-white/55">
              Available {product.unit}
              {figures.available === 1 ? "" : "s"}
            </p>
            <p className={`font-display text-6xl font-bold leading-none ${figures.available <= 0 ? "text-[#ff8a80]" : "text-gold"}`}>
              {figures.available}
            </p>
          </div>
          <div className="min-w-0">
            <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
              {figures.available > 0 && <span className="bg-gold" style={{ flexGrow: figures.available, flexBasis: 0 }} />}
              {figures.reserved > 0 && <span className="bg-[#7c8cf8]" style={{ flexGrow: figures.reserved, flexBasis: 0 }} />}
              {figures.damaged > 0 && <span className="bg-[#f2766b]" style={{ flexGrow: figures.damaged, flexBasis: 0 }} />}
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
              {[
                { label: "On hand", value: figures.physical, dot: "bg-white/40" },
                { label: "Available", value: figures.available, dot: "bg-gold" },
                { label: "Reserved", value: figures.reserved, dot: "bg-[#7c8cf8]" },
                { label: "Damaged", value: figures.damaged, dot: "bg-[#f2766b]" },
              ].map((f) => (
                <div key={f.label}>
                  <dt className="flex items-center gap-1.5 text-xs text-white/55">
                    <span className={`h-2 w-2 rounded-full ${f.dot}`} />
                    {f.label}
                  </dt>
                  <dd className="mt-0.5 font-tabular text-xl font-semibold">{f.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </header>

      <div className="rail-layout">
        <div>
      <section>
        <h2 className="section-title mb-3">Add or remove stock</h2>
        <StockMovementForm productId={product.id} />
      </section>

      <section>
        <h2 className="section-title mb-3">Stock history</h2>
        {movements.length === 0 ? (
          <p className="empty">
            No movements recorded yet.
          </p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr className="thead-row">
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Reason</th>
                  <th className="py-2 pr-4">Reference</th>
                  <th className="py-2 pr-4">Note</th>
                  <th className="py-2 pr-4">By</th>
                  <th className="py-2 pr-4 text-right">On hand</th>
                  <th className="py-2 pr-4 text-right">Reserved</th>
                  <th className="py-2 pr-4 text-right">Damaged</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="trow">
                    <td className="py-3 pr-4 text-xs text-text-muted">{formatDateTime(m.createdAt)}</td>
                    <td className="whitespace-nowrap py-3 pr-4 font-medium text-ink">{REASON_LABEL[m.reason] ?? m.reason}</td>
                    <td className="py-3 pr-4 font-tabular text-text-muted">{m.reference ?? "—"}</td>
                    <td className="py-3 pr-4 max-w-xs truncate text-text-muted">{m.note ?? "—"}</td>
                    <td className="py-3 pr-4 text-text-muted">{m.createdBy?.name ?? "—"}</td>
                    {[m.physicalDelta, m.reservedDelta, m.damagedDelta].map((delta, i) => (
                      <td
                        key={i}
                        className={`py-3 pr-4 text-right font-tabular ${
                          delta === 0 ? "text-text-muted/50" : delta > 0 ? "font-medium text-status-success-fg" : "font-medium text-status-attention-fg"
                        }`}
                      >
                        {delta === 0 ? "—" : `${delta > 0 ? "+" : ""}${delta}`}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <details className="disclosure">
        <summary className="rounded-2xl border border-line bg-surface px-5 py-4 shadow-card">Edit product details</summary>
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
      </details>

        </div>

        <aside>
      <section>
        <h2 className="section-title mb-3">Photos</h2>
        <ProductImages productId={product.id} images={product.images} />
      </section>

        </aside>
      </div>
    </div>
  );
}
