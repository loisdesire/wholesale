import Link from "next/link";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { getStockBreakdownByProduct } from "@/lib/stock";
import { ci } from "@/lib/search";
import {
  Plus,
  Search,
  Download,
  Upload,
  Package,
} from "lucide-react";

const PAGE_SIZE = 50;

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; status?: string }>;
}) {
  const { q, page: pageParam, status: statusFilter } = await searchParams;
  const session = await auth();
  const organizationId = session!.user.organizationId;
  const db = tenantDb(organizationId);

  const query = q?.trim() ?? "";
  const page = Math.max(1, Number(pageParam) || 1);

  const where = {
    organizationId,
    ...(statusFilter === "active" ? { active: true } : statusFilter === "inactive" ? { active: false } : {}),
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

  const stockMap = await getStockBreakdownByProduct(
    organizationId,
    { productIds: products.map((p) => p.id) },
    db
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const link = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { q: query || undefined, status: statusFilter, page: undefined, ...overrides };
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
    const qs = next.toString();
    return qs ? `/catalogue?${qs}` : "/catalogue";
  };

  return (
    <div className="flex flex-col gap-6 pb-16">
      {/* Page Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-baseline gap-2.5">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Catalogue &amp; Stock</h1>
            <span className="font-tabular text-sm text-text-muted">{totalCount} SKUs</span>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            Active inventory batches, wholesale tier pricing, and SKU availability.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/api/catalogue/export"
            className="inline-flex h-10 items-center gap-1.5 border border-line bg-surface px-3.5 text-xs font-semibold text-ink hover:bg-paper transition-colors cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 text-text-muted" />
            <span>Export CSV</span>
          </a>
          <Link
            href="/catalogue/import"
            className="inline-flex h-10 items-center gap-1.5 border border-line bg-surface px-3.5 text-xs font-semibold text-ink hover:bg-paper transition-colors"
          >
            <Upload className="h-3.5 w-3.5 text-text-muted" />
            <span>Import CSV</span>
          </Link>
          <Link
            href="/catalogue/new"
            className="inline-flex h-10 items-center gap-1.5 bg-accent px-4 text-xs font-semibold text-white transition-colors hover:bg-accent-2 cursor-pointer"
          >
            <Plus className="h-4 w-4 stroke-[2.5]" />
            <span>New Product</span>
          </Link>
        </div>
      </header>

      {/* Search and Filters Bar */}
      <div className="border border-line flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <form action="/catalogue" className="relative min-w-[260px] flex-1">
          {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search catalogue by product name or SKU…"
            className="w-full border border-line bg-paper/50 py-2.5 pl-10 pr-4 text-base sm:text-sm text-ink outline-none transition-all placeholder:text-text-muted/60 focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10"
          />
        </form>

        {/* Status Quick Filter Tabs — plain underline, not a pill segmented control */}
        <nav aria-label="Filter by status" className="flex items-center gap-5 text-xs font-semibold">
          <Link
            href={link({ status: undefined })}
            className={`border-b-2 pb-0.5 transition-colors ${
              !statusFilter ? "border-accent text-ink" : "border-transparent text-text-muted hover:text-ink"
            }`}
          >
            All items
          </Link>
          <Link
            href={link({ status: "active" })}
            className={`border-b-2 pb-0.5 transition-colors ${
              statusFilter === "active" ? "border-accent text-ink" : "border-transparent text-text-muted hover:text-ink"
            }`}
          >
            Active only
          </Link>
          <Link
            href={link({ status: "inactive" })}
            className={`border-b-2 pb-0.5 transition-colors ${
              statusFilter === "inactive" ? "border-accent text-ink" : "border-transparent text-text-muted hover:text-ink"
            }`}
          >
            Archived
          </Link>
        </nav>
      </div>

      {/* Products Table & Mobile Cards */}
      {products.length === 0 ? (
        <div className="border border-line flex flex-col items-center justify-center p-12 text-center">
          <Package className="h-6 w-6 text-text-muted" />
          <h2 className="mt-3 font-display text-base font-bold text-ink">
            {query ? `No items found matching "${query}"` : "Catalogue is empty"}
          </h2>
          <p className="mt-1 max-w-sm text-xs text-text-muted">
            {query
              ? "Check for SKU spelling variations or clear the search query."
              : "Add your first wholesale garment or fabric item to begin trade."}
          </p>
          {!query && (
            <Link
              href="/catalogue/new"
              className="mt-4 inline-flex h-10 items-center gap-1.5 bg-accent px-4 text-xs font-semibold text-white"
            >
              <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
              <span>Add First Product</span>
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Mobile Card Stack (< 640px) */}
          <div className="block sm:hidden space-y-3">
            {products.map((p) => {
              const figures = stockMap.get(p.id);
              const available = figures?.available ?? 0;
              const physical = figures?.physical ?? 0;
              const variant = p.variantAttributes as Record<string, string> | null;
              const thumbnail = p.images[0];

              return (
                <Link
                  key={p.id}
                  href={`/catalogue/${p.id}`}
                  className="card-base block p-4 transition-colors active:bg-paper/80"
                >
                  <div className="flex items-start gap-3.5">
                    {/* Thumbnail */}
                    <div className="shrink-0">
                      {thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/product-images/${thumbnail.id}`}
                          alt=""
                          className="h-14 w-14 rounded-xl border border-line object-cover shadow-2xs"
                        />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-dashed border-line bg-paper/50 text-text-muted/60">
                          <Package className="h-6 w-6" />
                        </div>
                      )}
                    </div>

                    {/* Details */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="font-semibold text-ink text-base truncate">
                          {p.name}
                        </h2>
                        <span className="font-tabular font-bold text-ink text-sm shrink-0">
                          {formatMoney(p.priceCents, p.currency)}
                        </span>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="inline-block rounded-md bg-paper/90 px-1.5 py-0.5 font-mono text-xs font-bold text-ink">
                          {p.sku}
                        </span>
                        {variant && (
                          <span className="rounded-md border border-line/60 bg-paper/50 px-1.5 py-0.5 text-xs font-semibold text-text-muted">
                            {Object.values(variant).join(" / ")}
                          </span>
                        )}
                      </div>

                      {/* Stock & Status Bar */}
                      <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-2 text-xs">
                        <div>
                          {p.active ? (
                            <span className="inline-flex items-center gap-1.5 text-emerald-800 font-medium text-xs">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              <span>Active</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-stone-500 font-medium text-xs">
                              <span className="h-1.5 w-1.5 rounded-full bg-stone-400" />
                              <span>Archived</span>
                            </span>
                          )}
                        </div>

                        <div className="text-right">
                          <span
                            className={`font-tabular text-xs font-bold ${
                              available === 0 ? "text-rose-600" : "text-ink"
                            }`}
                          >
                            {available} {p.unit}{available === 1 ? "" : "s"} avail
                          </span>
                          <span className="font-tabular text-xs text-text-muted ml-1">
                            ({physical} total)
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Desktop Table View (>= 640px) */}
          <div className="hidden sm:block card-base overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm table-fixed">
                <thead>
                  <tr className="border-b border-line text-xs font-medium text-text-muted">
                    <th className="py-3.5 pl-5 pr-3 w-[64px]"></th>
                    <th className="py-3.5 pr-4 w-[150px]">SKU</th>
                    <th className="py-3.5 pr-4 min-w-[220px]">Product</th>
                    <th className="py-3.5 pr-4 w-[180px]">Variant</th>
                    <th className="py-3.5 pr-4 w-[100px]">Status</th>
                    <th className="py-3.5 pr-4 text-right w-[150px]">Available</th>
                    <th className="py-3.5 pl-4 pr-5 text-right w-[140px]">List price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {products.map((p) => {
                    const figures = stockMap.get(p.id);
                    const available = figures?.available ?? 0;
                    const physical = figures?.physical ?? 0;
                    const variant = p.variantAttributes as Record<string, string> | null;
                    const thumbnail = p.images[0];

                    return (
                      <tr
                        key={p.id}
                        className="group transition-colors hover:bg-paper/40 cursor-pointer"
                      >
                        {/* Photo Thumbnail */}
                        <td className="py-3 pl-5 pr-3 align-middle">
                          <Link href={`/catalogue/${p.id}`} className="block">
                            {thumbnail ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={`/api/product-images/${thumbnail.id}`}
                                alt=""
                                className="h-10 w-10 rounded-xl border border-line object-cover shadow-2xs transition-transform group-hover:scale-105"
                              />
                            ) : (
                              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-dashed border-line bg-paper/50 text-text-muted/60">
                                <Package className="h-4 w-4" />
                              </div>
                            )}
                          </Link>
                        </td>

                        {/* SKU */}
                        <td className="py-3.5 pr-4 align-middle">
                          <Link
                            href={`/catalogue/${p.id}`}
                            className="inline-flex items-center rounded-md bg-paper/80 px-2 py-1 font-mono text-xs font-bold text-ink group-hover:bg-accent/10 group-hover:text-accent transition-colors"
                          >
                            {p.sku}
                          </Link>
                        </td>

                        {/* Product Title */}
                        <td className="py-3.5 pr-4 align-middle">
                          <Link href={`/catalogue/${p.id}`} className="block">
                            <p className="font-semibold text-ink group-hover:text-accent transition-colors">
                              {p.name}
                            </p>
                            <p className="text-xs text-text-muted">MOQ: {p.moq} {p.unit}{p.moq === 1 ? "" : "s"}</p>
                          </Link>
                        </td>

                        {/* Variant Attributes */}
                        <td className="py-3.5 pr-4 text-xs font-medium text-text-muted align-middle overflow-hidden">
                          {variant ? (
                            <span
                              title={Object.values(variant).join(" / ")}
                              className="block max-w-full truncate rounded-md border border-line/60 bg-paper/60 px-2 py-0.5 text-xs font-semibold text-ink"
                            >
                              {Object.values(variant).join(" / ")}
                            </span>
                          ) : (
                            <span className="text-text-muted/60">—</span>
                          )}
                        </td>

                        {/* Active Status Pip */}
                        <td className="py-3.5 pr-4 align-middle text-xs">
                          {p.active ? (
                            <span className="inline-flex items-center gap-1.5 text-emerald-800 font-medium">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              <span>Active</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-stone-500 font-medium">
                              <span className="h-1.5 w-1.5 rounded-full bg-stone-400" />
                              <span>Archived</span>
                            </span>
                          )}
                        </td>

                        {/* Available Stock */}
                        <td className="py-3.5 pr-4 text-right align-middle">
                          <div className="flex flex-col items-end">
                            <span
                              className={`font-tabular text-sm font-bold ${
                                available === 0 ? "text-rose-600" : "text-ink"
                              }`}
                            >
                              {available} {p.unit}{available === 1 ? "" : "s"}
                            </span>
                            <span className="font-tabular text-xs text-text-muted">
                              ({physical} on hand)
                            </span>
                          </div>
                        </td>

                        {/* Price */}
                        <td className="py-3.5 pl-4 pr-5 text-right align-middle">
                          <Link
                            href={`/catalogue/${p.id}`}
                            className="inline-flex items-center justify-end font-tabular text-sm font-bold text-ink group-hover:text-accent transition-colors"
                          >
                            {formatMoney(p.priceCents, p.currency)}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2 pt-2 text-xs text-text-muted">
          <span>
            Page <strong className="text-ink">{page}</strong> of {totalPages} ({totalCount} items)
          </span>
          <div className="flex items-center gap-2">
            {page > 1 && (
              <Link
                href={link({ page: String(page - 1) })}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 font-medium text-ink hover:bg-paper transition-colors"
              >
                ← Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={link({ page: String(page + 1) })}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 font-medium text-ink hover:bg-paper transition-colors"
              >
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
