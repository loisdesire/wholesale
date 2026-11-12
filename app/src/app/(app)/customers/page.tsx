import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { getCustomerBalances } from "@/lib/balances";
import { customerMatch } from "@/lib/search";
import { formatMoney } from "@/lib/format";

const PAGE_SIZE = 50;
const FILTERS = [
  { value: undefined, label: "All" },
  { value: "owes", label: "Owes us" },
  { value: "owed", label: "We owe them" },
] as const;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; page?: string }>;
}) {
  const params = await searchParams;
  const session = await auth();
  const organizationId = session!.user.organizationId;
  const db = tenantDb(organizationId);

  const q = params.q?.trim() || undefined;
  const filter = params.filter === "owes" || params.filter === "owed" ? params.filter : undefined;
  const page = Math.max(1, Number(params.page) || 1);

  // Balances are summed from orders and refunds, so a balance filter first asks
  // which customers have the balance, then loads just those.
  const balances = await getCustomerBalances(organizationId);
  const idsForFilter =
    filter === "owes"
      ? [...balances].filter(([, b]) => b.outstandingCents > 0).map(([id]) => id)
      : filter === "owed"
        ? [...balances].filter(([, b]) => b.refundDueCents > 0).map(([id]) => id)
        : undefined;

  const where = {
    organizationId,
    mergedIntoId: null,
    ...(idsForFilter ? { id: { in: idsForFilter } } : {}),
    ...(q ? customerMatch(q) : {}),
  };
  const [customers, totalCount] = await Promise.all([
    db.customer.findMany({
      where,
      include: { _count: { select: { orders: true, conversations: true } } },
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.customer.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const link = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ q, filter, ...overrides })) if (value) next.set(key, value);
    const qs = next.toString();
    return qs ? `/customers?${qs}` : "/customers";
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="page-head">
        <h1 className="page-title">Customers</h1>
        <Link href="/customers/new" className="btn btn-primary">
          <Plus size={16} strokeWidth={2.4} />
          New customer
        </Link>
      </header>

      <div className="flex flex-col gap-3">
        <form action="/customers" className="relative max-w-md">
          {filter && <input type="hidden" name="filter" value={filter} />}
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Search customers"
            aria-label="Search customers by name, phone, email or notes"
            className="input w-full pl-9"
          />
        </form>
        <nav aria-label="Filter by balance" className="chip-row">
          {FILTERS.map((f) => {
            const active = filter === f.value;
            return (
              <Link
                key={f.label}
                href={link({ filter: f.value, page: undefined })}
                aria-current={active ? "true" : undefined}
                className={`chip ${active ? "chip-active" : ""}`}
              >
                {f.label}
              </Link>
            );
          })}
          {(q || filter) && (
            <Link href="/customers" className="link self-center pl-1 text-xs">
              Clear
            </Link>
          )}
        </nav>
      </div>

      {customers.length === 0 ? (
        <p className="empty">
          {q || filter ? "No customers match." : "No customers yet."}
        </p>
      ) : (
        <>
        {/* Phone: who they are, and money only when there is some. */}
        <ul className="card divide-y divide-line overflow-hidden md:hidden">
          {customers.map((c) => {
            const owes = balances.get(c.id)?.outstandingCents ?? 0;
            const weOwe = balances.get(c.id)?.refundDueCents ?? 0;
            return (
              <li key={c.id}>
                <Link href={`/customers/${c.id}`} className="mrow">
                  <Avatar name={c.name ?? c.phone} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{c.name ?? "Unnamed"}</span>
                    <span className="block truncate font-tabular text-xs text-text-muted">{c.phone}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs">
                    {owes > 0 && (
                      <span className="text-text-muted">
                        Owes <span className="font-tabular text-sm font-semibold text-ink">{formatMoney(owes)}</span>
                      </span>
                    )}
                    {weOwe > 0 && (
                      <span className="text-status-attention-fg">
                        You owe <span className="font-tabular text-sm font-semibold">{formatMoney(weOwe)}</span>
                      </span>
                    )}
                    {owes <= 0 && weOwe <= 0 && (
                      <span className="text-text-muted">
                        {c._count.orders} order{c._count.orders === 1 ? "" : "s"}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="card hidden overflow-x-auto md:block">
          <table className="table">
            <thead>
              <tr className="thead-row">
                <th className="py-2 pr-4">Customer</th>
                <th className="py-2 pr-4">Notes</th>
                <th className="py-2 pr-4 text-right">Chats</th>
                <th className="py-2 pr-4 text-right">Orders</th>
                <th className="py-2 pr-4 text-right">Owes us</th>
                <th className="py-2 pr-4 text-right">We owe</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const owes = balances.get(c.id)?.outstandingCents ?? 0;
                const weOwe = balances.get(c.id)?.refundDueCents ?? 0;
                return (
                  <tr key={c.id} className="trow">
                    <td className="py-2.5 pr-4">
                      <Link href={`/customers/${c.id}`} className="group flex items-center gap-3">
                        <Avatar name={c.name ?? c.phone} />
                        <span className="min-w-0">
                          <span className="block whitespace-nowrap font-medium text-ink underline-offset-4 group-hover:text-accent group-hover:underline">
                            {c.name ?? "Unnamed"}
                          </span>
                          <span className="block whitespace-nowrap font-tabular text-xs text-text-muted">{c.phone}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="max-w-xs truncate py-2.5 pr-4 text-text-muted">{c.notes ?? "—"}</td>
                    <td className="py-2.5 pr-4 text-right font-tabular text-text-muted">{c._count.conversations}</td>
                    <td className="py-2.5 pr-4 text-right font-tabular text-text-muted">{c._count.orders}</td>
                    {/* A zero balance is the normal case, so it recedes; only real money gets weight. */}
                    <td className={`whitespace-nowrap py-2.5 pr-4 text-right font-tabular ${owes > 0 ? "font-semibold text-ink" : "text-text-muted/60"}`}>
                      {owes > 0 ? formatMoney(owes) : "—"}
                    </td>
                    <td
                      className={`whitespace-nowrap py-2.5 pr-4 text-right font-tabular ${
                        weOwe > 0 ? "font-semibold text-status-attention-fg" : "text-text-muted/60"
                      }`}
                    >
                      {weOwe > 0 ? formatMoney(weOwe) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      {totalPages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={link({ page: String(page - 1) })} className="text-ink underline-offset-2 hover:underline">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-text-muted">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={link({ page: String(page + 1) })} className="text-ink underline-offset-2 hover:underline">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
