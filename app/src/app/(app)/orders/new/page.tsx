import Link from "next/link";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { getStockByProduct } from "@/lib/stock";
import { NewOrderForm } from "./new-order-form";
import { ArrowLeft, ShoppingBag } from "lucide-react";

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; conversationId?: string }>;
}) {
  const { customerId, conversationId } = await searchParams;
  const session = await auth();
  const organizationId = session!.user.organizationId;
  const db = tenantDb(organizationId);

  const [customers, products, stockMap, agreedRows] = await Promise.all([
    db.customer.findMany({ where: { organizationId, mergedIntoId: null }, orderBy: { name: "asc" } }),
    db.product.findMany({
      where: { organizationId, active: true },
      include: { priceTiers: { orderBy: { minQuantity: "asc" } } },
      orderBy: { name: "asc" },
    }),
    getStockByProduct(organizationId, db),
    db.customerPrice.findMany({ where: { organizationId } }),
  ]);
  const agreedPrices: Record<string, Record<string, number>> = {};
  for (const row of agreedRows) (agreedPrices[row.customerId] ??= {})[row.productId] = row.priceCents;

  const productOptions = products.map((p) => {
    const variant = p.variantAttributes as Record<string, string> | null;
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      variantLabel: variant ? Object.values(variant).join(" / ") : null,
      priceCents: p.priceCents,
      priceTiers: p.priceTiers.map((t) => ({ minQuantity: t.minQuantity, priceCents: t.priceCents })),
      moq: p.moq,
      unit: p.unit,
      stock: stockMap.get(p.id) ?? 0,
    };
  });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 pb-12">
      <header className="flex flex-col gap-1.5 border-b border-line pb-4">
        <div>
          <Link
            href="/orders"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-text-muted transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Orders
          </Link>
        </div>
        <div className="mt-2 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-paper shadow-sm">
            <ShoppingBag className="h-4 w-4" />
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Create Wholesale Order
          </h1>
        </div>
        <p className="text-sm text-text-muted">
          Drafts do not reserve stock. Stock is only reserved when the draft is confirmed or paid.
        </p>
      </header>

      <NewOrderForm
        customers={customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone }))}
        products={productOptions}
        defaultCustomerId={customerId}
        conversationId={conversationId}
        agreedPrices={agreedPrices}
      />
    </div>
  );
}
