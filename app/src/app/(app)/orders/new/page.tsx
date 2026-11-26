import Link from "next/link";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { getStockByProduct } from "@/lib/stock";
import { recentCustomersForPicker } from "@/lib/customer-picker";
import { NewOrderForm } from "./new-order-form";

export const metadata = { title: "New order" };

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; conversationId?: string }>;
}) {
  const { customerId, conversationId } = await searchParams;
  const session = await auth();
  const organizationId = session!.user.organizationId;
  const db = tenantDb(organizationId);

  const [customers, products, stockMap] = await Promise.all([
    // Only the most recently active customers (plus the one this order is for); the rest are found by searching.
    recentCustomersForPicker(organizationId, customerId),
    db.product.findMany({
      where: { organizationId, active: true },
      include: { priceTiers: { orderBy: { minQuantity: "asc" } } },
      orderBy: { name: "asc" },
    }),
    getStockByProduct(organizationId, db),
  ]);

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
        <Link href="/orders" className="back-link">
          ← Orders
        </Link>
        <h1 className="mt-2 page-title">New order</h1>
      </header>

      <NewOrderForm
        customers={customers}
        products={productOptions}
        defaultCustomerId={customerId}
        conversationId={conversationId}
      />
    </div>
  );
}
