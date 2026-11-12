import Link from "next/link";
import { Package, Plus, Search } from "lucide-react";
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
      include: { images: { orderBy: { position: "asc" }, take: 1, select: { id: true } } },
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
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="page-title">Catalogue</h1>
          <p className="mt-1 text-sm text-text-muted">
            Stock is a running ledger, not an editable number — this total is the
            sum of every movement recorded for the product.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href="/api/catalogue/export"
            className="btn btn-secondary"
          >
            Export CSV
          </a>
          <Link
            href="/catalogue/import"
            className="btn btn-secondary"
          >
            Import CSV
          </Link>
          <Link
            href="/catalogue/new"
            className="btn btn-primary"
          >
            <Plus size={16} strokeWidth={2.4} />
            New product
          </Link>
        </div>
      </header>

      <form action="/catalogue" className="relative flex max-w-sm">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search by name or SKU…"
          aria-label="Search products"
          className="input w-full pl-9"
        />
      </form>

      {products.length === 0 ? (
        <p className="empty">
          {query ? (
            `No products match "${query}".`
          ) : (
            <>
              No products yet.{" "}
              <Link href="/catalogue/new" className="link">
                Add the first one
              </Link>
              .
            </>
          )}
        </p>
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr className="thead-row">
                  <th className="py-2 pr-4">Product</th>
                  <th className="py-2 pr-4">SKU</th>
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
                  const thumbnail = p.images[0];
                  // Colour says what the number means: out (red), running low (amber), fine (ink).
                  const stockTone =
                    stock <= 0 ? "text-status-attention-fg" : stock <= 5 ? "text-status-progress-fg" : "text-ink";
                  return (
                    <tr key={p.id} className="trow">
                      <td className="py-2.5 pr-4">
                        <Link href={`/catalogue/${p.id}`} className="group flex items-center gap-3">
                          {thumbnail ? (
                            // eslint-disable-next-line @next/next/no-img-element -- tenant-private, authenticated route, not a static asset Next's image optimizer can handle
                            <img
                              src={`/api/product-images/${thumbnail.id}`}
                              alt=""
                              className="h-11 w-11 shrink-0 rounded-lg border border-line object-cover"
                            />
                          ) : (
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-paper text-text-muted/70">
                              <Package size={18} strokeWidth={1.6} />
                            </span>
                          )}
                          <span className="min-w-0">
                            <span className="block whitespace-nowrap font-medium text-ink underline-offset-4 group-hover:text-accent group-hover:underline">
                              {p.name}
                            </span>
                            <span className="block whitespace-nowrap text-xs text-text-muted">
                              {variant ? Object.values(variant).join(" / ") : "No variant"}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-4 font-mono text-xs text-text-muted">{p.sku}</td>
                      <td className="py-2.5 pr-4">
                        {p.active ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-status-success-fg">
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-text-muted">
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className={`whitespace-nowrap py-2.5 pr-4 text-right font-tabular ${stockTone}`}>
                        <span className="font-semibold">{stock}</span>{" "}
                        <span className="text-xs">
                          {p.unit}
                          {stock === 1 ? "" : "s"}
                        </span>
                        {stock <= 0 ? (
                          <span className="ml-2 rounded-full bg-status-attention-bg px-1.5 py-0.5 text-[11px] font-semibold">Out</span>
                        ) : stock <= 5 ? (
                          <span className="ml-2 rounded-full bg-status-progress-bg px-1.5 py-0.5 text-[11px] font-semibold">Low</span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-4 text-right font-tabular font-medium text-ink">
                        {formatMoney(p.priceCents, p.currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-text-muted">
              <span>
                Page {page} of {totalPages} · {totalCount} products
              </span>
              <div className="flex gap-3">
                {page > 1 && (
                  <Link href={pageLink(page - 1)} className="link">
                    Previous
                  </Link>
                )}
                {page < totalPages && (
                  <Link href={pageLink(page + 1)} className="link">
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
