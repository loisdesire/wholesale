import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStockByProduct } from "@/lib/stock";
import { serializeProductsCsv } from "@/lib/csv";

export async function GET() {
  const session = await auth();
  if (!session) {
    return new Response("Not signed in", { status: 401 });
  }

  const organizationId = session.user.organizationId;
  const [products, stockMap] = await Promise.all([
    prisma.product.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
    getStockByProduct(organizationId),
  ]);

  const csv = serializeProductsCsv(
    products.map((p) => ({
      sku: p.sku,
      name: p.name,
      variantAttributes: p.variantAttributes,
      priceCents: p.priceCents,
      costCents: p.costCents,
      moq: p.moq,
      unit: p.unit,
      active: p.active,
      stock: stockMap.get(p.id) ?? 0,
    }))
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="catalogue-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
