import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { getStockBreakdown } from "@/lib/stock";
import { formatDateTime, formatMoney } from "@/lib/format";
import { EditProductForm } from "./edit-product-form";
import { StockMovementForm } from "./stock-movement-form";
import { ProductImages } from "./product-images";
import { ArrowLeft } from "lucide-react";

const REASON_LABEL: Record<string, string> = {
  INITIAL_STOCK: "Opening stock balance",
  PURCHASE_RECEIVED: "Purchase intake received",
  SALE_RESERVED: "Customer order reserved",
  SALE_FULFILLED: "Order dispatched & fulfilled",
  RESERVATION_RELEASED: "Order cancelled / reservation freed",
  RETURN: "Customer return accepted",
  RETURN_DAMAGED: "Damaged customer return",
  DAMAGE: "Stock moved to damaged quarantine",
  DAMAGE_WRITTEN_OFF: "Damaged goods written off",
  MANUAL_ADJUSTMENT: "Manual inventory count adjustment",
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
    <div className="flex flex-col gap-6 pb-16">
      {/* Top Header Card */}
      <header className="card-base flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/catalogue"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-paper/60 text-ink hover:bg-paper transition-colors"
              title="Return to catalogue ledger"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                  {product.name}
                </h1>
                {product.active ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-emerald-800 font-medium">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    <span>Active</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs text-stone-500 font-medium">
                    <span className="h-1.5 w-1.5 rounded-full bg-stone-400" />
                    <span>Archived</span>
                  </span>
                )}
              </div>
              <p className="mt-0.5 font-tabular text-xs text-text-muted">
                {product.sku}
                {variant && <span className="ml-3 font-semibold text-ink/80">{Object.values(variant).join(" / ")}</span>}
                <span className="ml-3">MOQ: {product.moq} {product.unit}{product.moq === 1 ? "" : "s"}</span>
              </p>
            </div>
          </div>

          <div className="text-right">
            <span className="text-xs text-text-muted">Standard list price</span>
            <p className="font-tabular text-xl font-bold text-ink">
              {formatMoney(product.priceCents, product.currency)}
            </p>
          </div>
        </div>

        {/* Stock breakdown — one hairline-divided row, not four boxed stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-line/70 border border-line">
          <div className="p-3.5">
            <span className="text-xs text-text-muted">Available to sell</span>
            <p className={`mt-0.5 font-tabular text-xl font-bold ${figures.available === 0 ? "text-rose-700" : "text-emerald-700"}`}>
              {figures.available} <span className="text-xs font-normal text-text-muted">{product.unit}{figures.available === 1 ? "" : "s"}</span>
            </p>
          </div>
          <div className="p-3.5">
            <span className="text-xs text-text-muted">Physical on hand</span>
            <p className="mt-0.5 font-tabular text-xl font-bold text-ink">
              {figures.physical} <span className="text-xs font-normal text-text-muted">{product.unit}{figures.physical === 1 ? "" : "s"}</span>
            </p>
          </div>
          <div className="p-3.5">
            <span className="text-xs text-text-muted">Allocated to orders</span>
            <p className="mt-0.5 font-tabular text-xl font-bold text-amber-700">
              {figures.reserved} <span className="text-xs font-normal text-text-muted">{product.unit}{figures.reserved === 1 ? "" : "s"}</span>
            </p>
          </div>
          <div className="p-3.5">
            <span className="text-xs text-text-muted">Quarantine / damaged</span>
            <p className="mt-0.5 font-tabular text-xl font-bold text-ink">
              {figures.damaged} <span className="text-xs font-normal text-text-muted">{product.unit}{figures.damaged === 1 ? "" : "s"}</span>
            </p>
          </div>
        </div>
      </header>

      {/* Main 2-Column Responsive Layout */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column (2 Cols): Photo Manager, Specs & Movement History */}
        <div className="lg:col-span-2 space-y-6">
          {/* Photo Gallery Card */}
          <div className="card-base p-5 space-y-3.5">
            <div className="border-b border-line/60 pb-2.5">
              <h2 className="font-display text-sm font-bold text-ink">Product photography &amp; swatches</h2>
              <p className="text-xs text-text-muted">Visual references sent automatically to buyers over WhatsApp &amp; Telegram inquiries.</p>
            </div>
            <ProductImages productId={product.id} images={product.images} />
          </div>

          {/* Edit Product Specifications Form Card */}
          <div className="card-base p-5 space-y-3.5">
            <div className="border-b border-line/60 pb-2.5">
              <h2 className="font-display text-sm font-bold text-ink">Product specifications &amp; quantity tiers</h2>
              <p className="text-xs text-text-muted">Base unit costs, list pricing, minimum order quantities, and wholesale volume bands.</p>
            </div>
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
          </div>

          {/* Stock Movement History Table */}
          <div className="card-base overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <h2 className="font-display text-sm font-bold text-ink">Stock movement audit trail</h2>
              <span className="font-tabular text-xs font-semibold text-text-muted">
                Last {movements.length} ledger entries
              </span>
            </div>

            {movements.length === 0 ? (
              <p className="p-8 text-center text-xs text-text-muted">No stock movements recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm table-fixed">
                  <thead>
                    <tr className="border-b border-line text-xs font-medium text-text-muted">
                      <th className="py-3 pl-5 pr-4 w-[160px]">Timestamp</th>
                      <th className="py-3 pr-4 w-[170px]">Ledger reason</th>
                      <th className="py-3 pr-4 w-[120px]">Reference</th>
                      <th className="py-3 pr-4 w-[150px]">Note</th>
                      <th className="py-3 pr-4 w-[110px]">Actor</th>
                      <th className="py-3 pr-4 text-right w-[80px]">Physical</th>
                      <th className="py-3 pr-4 text-right w-[80px]">Reserved</th>
                      <th className="py-3 pr-5 text-right w-[80px]">Damaged</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60 text-xs">
                    {movements.map((m) => (
                      <tr key={m.id} className="transition-colors hover:bg-paper/20">
                        <td className="py-3 pl-5 pr-4 font-tabular text-text-muted">
                          {formatDateTime(m.createdAt)}
                        </td>
                        <td className="py-3 pr-4 font-semibold text-ink">
                          {REASON_LABEL[m.reason] ?? m.reason}
                        </td>
                        <td className="py-3 pr-4 font-mono text-text-muted">
                          {m.reference ?? "—"}
                        </td>
                        <td className="py-3 pr-4 truncate text-text-muted">
                          {m.note ?? "—"}
                        </td>
                        <td className="py-3 pr-4 text-text-muted">
                          {m.createdBy?.name ?? "System"}
                        </td>
                        <td className={`py-3 pr-4 text-right font-tabular font-semibold ${m.physicalDelta > 0 ? "text-emerald-700" : m.physicalDelta < 0 ? "text-rose-700" : "text-text-muted"}`}>
                          {m.physicalDelta === 0 ? "—" : `${m.physicalDelta > 0 ? "+" : ""}${m.physicalDelta}`}
                        </td>
                        <td className={`py-3 pr-4 text-right font-tabular font-semibold ${m.reservedDelta > 0 ? "text-amber-700" : m.reservedDelta < 0 ? "text-emerald-700" : "text-text-muted"}`}>
                          {m.reservedDelta === 0 ? "—" : `${m.reservedDelta > 0 ? "+" : ""}${m.reservedDelta}`}
                        </td>
                        <td className={`py-3 pr-5 text-right font-tabular font-semibold ${m.damagedDelta > 0 ? "text-rose-700" : "text-text-muted"}`}>
                          {m.damagedDelta === 0 ? "—" : `${m.damagedDelta > 0 ? "+" : ""}${m.damagedDelta}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Column (1 Col): Stock Movement Ledger Intake */}
        <div className="space-y-6">
          <div className="card-base p-5 space-y-3.5 sticky top-4">
            <div className="border-b border-line/60 pb-2.5">
              <h3 className="font-display text-sm font-bold text-ink">Post stock movement</h3>
              <p className="text-xs text-text-muted">
                Record intake deliveries, supplier receipts, damaged write-offs, or reconciliation counts.
              </p>
            </div>
            <StockMovementForm productId={product.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
