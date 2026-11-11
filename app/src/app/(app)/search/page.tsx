import Link from "next/link";
import { auth } from "@/lib/auth";
import { searchEverything } from "@/lib/search";
import { formatMoney } from "@/lib/format";
import { OrderStatusBadge, ReturnStatusBadge } from "@/components/status-badge";
import {
  Search,
  ShoppingBag,
  Users,
  Package,
  RotateCcw,
} from "lucide-react";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const session = await auth();
  const organizationId = session!.user.organizationId;
  const query = q?.trim() ?? "";
  const results = await searchEverything(organizationId, query);
  const total =
    results.orders.length + results.customers.length + results.products.length + results.returns.length;

  return (
    <div className="flex flex-col gap-8 pb-16">
      {/* Header & Global Command Search */}
      <header className="flex flex-col gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Global Search</h1>
          <p className="mt-1 text-sm text-text-muted">
            Search orders, customer accounts, phone numbers in any format, catalogue SKUs, and returns across the whole organization.
          </p>
        </div>

        {/* Search Bar */}
        <div className="card-base flex items-center gap-3 p-2.5 max-w-2xl">
          <form action="/search" className="flex flex-1 items-center gap-2 sm:gap-3">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                name="q"
                type="search"
                defaultValue={query}
                autoFocus
                placeholder="Enter order reference, customer phone, SKU, or name…"
                aria-label="Search"
                className="w-full bg-transparent py-2.5 pl-10 pr-4 text-base sm:text-sm text-ink outline-none placeholder:text-text-muted"
              />
            </div>
            <button
              type="submit"
              className="inline-flex min-h-[44px] items-center justify-center bg-accent px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent-2 cursor-pointer"
            >
              Search
            </button>
          </form>
        </div>
      </header>

      {/* Query status helpers */}
      {query.length > 0 && query.length < 2 && (
        <div className="border border-line p-6 text-center text-xs text-text-muted">
          Type at least two characters to search.
        </div>
      )}

      {query.length >= 2 && total === 0 && (
        <div className="border border-line flex flex-col items-center justify-center p-12 text-center">
          <Search className="h-6 w-6 text-text-muted" />
          <h2 className="mt-3 font-display text-base font-bold text-ink">
            No results found for &ldquo;{query}&rdquo;
          </h2>
          <p className="mt-1 text-xs text-text-muted max-w-sm">
            Check the spelling, verify the phone format, or try searching by SKU directly.
          </p>
        </div>
      )}

      {/* Results Groups */}
      <div className="space-y-6">
        {/* 1. Orders Results */}
        {results.orders.length > 0 && (
          <Group
            icon={ShoppingBag}
            title="Matching orders"
            count={results.orders.length}
            seeAll={`/orders?q=${encodeURIComponent(query)}`}
          >
            {results.orders.map((o) => (
              <Row key={o.id} href={`/orders/${o.id}`}>
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-ink group-hover:text-accent transition-colors">
                    {o.reference}
                  </span>
                  <OrderStatusBadge status={o.status} />
                  <span className="text-xs text-text-muted">
                    {o.customer.name ?? o.customer.phone}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-tabular text-sm font-bold text-ink">
                    {formatMoney(o.totalCents, o.currency)}
                  </span>
                </div>
              </Row>
            ))}
          </Group>
        )}

        {/* 2. Customer Results */}
        {results.customers.length > 0 && (
          <Group
            icon={Users}
            title="Matching customers"
            count={results.customers.length}
            seeAll={`/customers?q=${encodeURIComponent(query)}`}
          >
            {results.customers.map((c) => (
              <Row key={c.id} href={`/customers/${c.id}`}>
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-ink group-hover:text-accent transition-colors">
                    {c.name ?? "Unnamed Customer"}
                  </span>
                  <span className="font-tabular text-xs text-text-muted">{c.phone}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-text-muted">Customer profile</span>
                </div>
              </Row>
            ))}
          </Group>
        )}

        {/* 3. Catalogue Products Results */}
        {results.products.length > 0 && (
          <Group
            icon={Package}
            title="Matching products"
            count={results.products.length}
            seeAll={`/catalogue?q=${encodeURIComponent(query)}`}
          >
            {results.products.map((p) => (
              <Row key={p.id} href={`/catalogue/${p.id}`}>
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-ink group-hover:text-accent transition-colors">
                    {p.name}
                  </span>
                  <span className="font-tabular text-xs font-medium text-text-muted bg-paper px-2 py-0.5 rounded-md">
                    {p.sku}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-tabular text-xs text-text-muted font-medium">SKU detail</span>
                </div>
              </Row>
            ))}
          </Group>
        )}

        {/* 4. Returns & Refunds Results */}
        {results.returns.length > 0 && (
          <Group
            icon={RotateCcw}
            title="Matching returns &amp; refunds"
            count={results.returns.length}
          >
            {results.returns.map((r) => (
              <Row key={r.id} href={`/orders/${r.orderId}`}>
                <div className="flex items-center gap-3">
                  <span className="font-tabular font-bold text-ink group-hover:text-accent transition-colors">
                    {r.reference}
                  </span>
                  <ReturnStatusBadge status={r.status} />
                  <span className="text-xs text-text-muted">
                    {r.customer.name ?? r.customer.phone} · Order {r.order.reference}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-tabular text-sm font-bold text-ink">
                    {formatMoney(r.refundCents, r.order.currency)}
                  </span>
                </div>
              </Row>
            ))}
          </Group>
        )}
      </div>
    </div>
  );
}

function Group({
  icon: Icon,
  title,
  count,
  seeAll,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count: number;
  seeAll?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card-base overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-accent" />
          <h2 className="font-display text-sm font-bold text-ink">{title}</h2>
          <span className="font-tabular text-xs text-text-muted">{count}</span>
        </div>
        {seeAll && (
          <Link href={seeAll} className="text-xs font-semibold text-accent hover:underline">
            View all
          </Link>
        )}
      </div>
      <div className="divide-y divide-line/70">{children}</div>
    </div>
  );
}

function Row({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-4 px-5 py-3.5 text-sm transition-colors hover:bg-paper/40 cursor-pointer"
    >
      {children}
    </Link>
  );
}
