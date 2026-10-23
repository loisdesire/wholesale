import Link from "next/link";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { getStockByProduct } from "@/lib/stock";
import { NewOrderForm } from "./new-order-form";

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
    <div className="flex flex-col gap-6">
      <header>
        <Link href="/orders" className="text-sm text-text-muted hover:text-ink">
          ← Orders
        </Link>
        <h1 className="mt-2 text-xl font-medium text-ink">New order</h1>
        <p className="mt-1 text-sm text-text-muted">
          Starts as a draft — nothing is reserved from stock until it&apos;s confirmed.
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
