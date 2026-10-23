import Link from "next/link";
import { auth } from "@/lib/auth";
import { searchEverything } from "@/lib/search";
import { formatMoney } from "@/lib/format";
import { OrderStatusBadge, ReturnStatusBadge } from "@/components/status-badge";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const session = await auth();
  const organizationId = session!.user.organizationId;
  const query = q?.trim() ?? "";
  const results = await searchEverything(organizationId, query);
  const total =
    results.orders.length + results.customers.length + results.products.length + results.returns.length;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-xl font-medium text-ink">Search</h1>
        <p className="mt-1 text-sm text-text-muted">
          Orders, customers, products and returns. Phone numbers match in any format.
        </p>
        <form action="/search" className="mt-4 flex max-w-xl gap-2">
          <input
            name="q"
            type="search"
            defaultValue={query}
            autoFocus
            placeholder="Order ref, name, phone, SKU…"
            aria-label="Search"
            className="flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
          />
          <button type="submit" className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink-2">
            Search
          </button>
        </form>
      </header>

      {query.length > 0 && query.length < 2 && (
        <p className="text-sm text-text-muted">Type at least two characters.</p>
      )}
      {query.length >= 2 && total === 0 && (
        <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-text-muted">
          Nothing matches &ldquo;{query}&rdquo;.
        </p>
      )}

      {results.orders.length > 0 && (
        <Group title="Orders" seeAll={`/orders?q=${encodeURIComponent(query)}`}>
          {results.orders.map((o) => (
            <Row key={o.id} href={`/orders/${o.id}`}>
              <span className="flex items-center gap-3">
                <span className="font-tabular text-ink">{o.reference}</span>
                <OrderStatusBadge status={o.status} />
                <span className="text-text-muted">{o.customer.name ?? o.customer.phone}</span>
              </span>
              <span className="font-tabular text-text-muted">{formatMoney(o.totalCents, o.currency)}</span>
            </Row>
          ))}
        </Group>
      )}

      {results.customers.length > 0 && (
        <Group title="Customers" seeAll={`/customers?q=${encodeURIComponent(query)}`}>
          {results.customers.map((c) => (
            <Row key={c.id} href={`/customers/${c.id}`}>
              <span className="text-ink">{c.name ?? "Unnamed"}</span>
              <span className="font-tabular text-text-muted">{c.phone}</span>
            </Row>
          ))}
        </Group>
      )}

      {results.products.length > 0 && (
        <Group title="Products" seeAll={`/catalogue?q=${encodeURIComponent(query)}`}>
          {results.products.map((p) => (
            <Row key={p.id} href={`/catalogue/${p.id}`}>
              <span className="text-ink">{p.name}</span>
              <span className="font-tabular text-text-muted">{p.sku}</span>
            </Row>
          ))}
        </Group>
      )}

      {results.returns.length > 0 && (
        <Group title="Returns & refunds">
          {results.returns.map((r) => (
            <Row key={r.id} href={`/orders/${r.orderId}`}>
              <span className="flex items-center gap-3">
                <span className="font-tabular text-ink">{r.reference}</span>
                <ReturnStatusBadge status={r.status} />
                <span className="text-text-muted">
                  {r.customer.name ?? r.customer.phone} · {r.order.reference}
                </span>
              </span>
              <span className="font-tabular text-text-muted">{formatMoney(r.refundCents, r.order.currency)}</span>
            </Row>
          ))}
        </Group>
      )}
    </div>
  );
}

function Group({ title, seeAll, children }: { title: string; seeAll?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        {seeAll && (
          <Link href={seeAll} className="text-xs text-text-muted underline-offset-2 hover:text-ink hover:underline">
            See all
          </Link>
        )}
      </div>
      <div className="divide-y divide-line rounded-md border border-line bg-surface">{children}</div>
    </section>
  );
}

function Row({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-paper">
      {children}
    </Link>
  );
}
