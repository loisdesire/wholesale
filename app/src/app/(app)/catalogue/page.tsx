import Link from "next/link";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { getStockBreakdownByProduct } from "@/lib/stock";
import { ci } from "@/lib/search";

const PAGE_SIZE = 50;

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q, page: pageParam } = await searchParams;
  const session = await auth();
  const organizationId = session!.user.organizationId;
  const db = tenantDb(organizationId);

  const query = q?.trim() ?? "";
  const page = Math.max(1, Number(pageParam) || 1);

  const where = {
    organizationId,
    ...(query
      ? {
          OR: [
            { name: ci(query) },
            { sku: ci(query) },
          ],
        }
      : {}),
  };

  const [products, totalCount] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.product.count({ where }),
  ]);
  // Only this page's products, not the whole catalogue's ledger.
  const stockMap = await getStockBreakdownByProduct(organizationId, {
    productIds: products.map((p) => p.id),
  }, db);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const pageLink = (p: number) =>
    `/catalogue?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(p) })}`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-medium text-ink">Catalogue</h1>
          <p className="mt-1 text-sm text-text-muted">
            Stock is a running ledger, not an editable number — this total is the
            sum of every movement recorded for the product.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/api/catalogue/export"
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-paper"
          >
            Export CSV
          </a>
          <Link
            href="/catalogue/import"
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-paper"
          >
            Import CSV
          </Link>
          <Link
            href="/catalogue/new"
            className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-paper transition-colors hover:bg-ink-2"
          >
            New product
          </Link>
        </div>
      </header>

      <form action="/catalogue" className="flex max-w-sm">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search by name or SKU…"
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
        />
      </form>

      {products.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-text-muted">
          {query ? (
            `No products match "${query}".`
          ) : (
            <>
              No products yet.{" "}
              <Link href="/catalogue/new" className="text-ink underline underline-offset-2">
                Add the first one
              </Link>
              .
            </>
          )}
        </p>
      ) : (
        <>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
                <th className="py-2 pr-4">SKU</th>
                <th className="py-2 pr-4">Product</th>
                <th className="py-2 pr-4">Variant</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4 text-right">Available</th>
                <th className="py-2 pr-4 text-right">Price</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const figures = stockMap.get(p.id);
                const stock = figures?.available ?? 0;
                const variant = p.variantAttributes as Record<string, string> | null;
                return (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="py-3 pr-4 font-tabular">
                      <Link href={`/catalogue/${p.id}`} className="text-ink hover:underline">
                        {p.sku}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 text-ink">{p.name}</td>
                    <td className="py-3 pr-4 text-text-muted">
                      {variant ? Object.values(variant).join(" / ") : "—"}
                    </td>
                    <td className="py-3 pr-4">
                      {p.active ? (
                        <span className="text-xs text-text-muted">Active</span>
                      ) : (
                        <span className="text-xs text-status-attention-fg">Inactive</span>
                      )}
                    </td>
                    <td
                      className={`py-3 pr-4 text-right font-tabular ${
                        stock === 0 ? "text-status-attention-fg" : "text-ink"
                      }`}
                    >
                      {stock} {p.unit}
                      {stock === 1 ? "" : "s"}
                    </td>
                    <td className="py-3 pr-4 text-right font-tabular text-ink">
                      {formatMoney(p.priceCents, p.currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-text-muted">
              <span>
                Page {page} of {totalPages} · {totalCount} products
              </span>
              <div className="flex gap-3">
                {page > 1 && (
                  <Link href={pageLink(page - 1)} className="text-ink underline underline-offset-2">
                    Previous
                  </Link>
                )}
                {page < totalPages && (
                  <Link href={pageLink(page + 1)} className="text-ink underline underline-offset-2">
                    Next
                  </Link>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
