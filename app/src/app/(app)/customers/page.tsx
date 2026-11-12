import Link from "next/link";
import { Plus } from "lucide-react";
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
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="page-title">Customers</h1>
          <p className="mt-1 text-sm text-text-muted">
            Identified by phone number, with their order and conversation history. Balances are summed from orders
            and refunds, never typed in.
          </p>
        </div>
        <Link
          href="/customers/new"
          className="btn btn-primary"
        >
          <Plus size={16} strokeWidth={2.4} />
          New customer
        </Link>
      </header>

      <div className="card flex flex-col gap-3 p-4">
        <form action="/customers" className="flex flex-wrap gap-2">
          {filter && <input type="hidden" name="filter" value={filter} />}
          <input
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Name, phone (any format), email, notes…"
            aria-label="Search customers"
            className="input w-full sm:w-80"
          />
          <button type="submit" className="btn btn-secondary">
            Search
          </button>
          {(q || filter) && (
            <Link href="/customers" className="py-2 text-sm text-text-muted underline-offset-2 hover:text-ink hover:underline">
              Clear
            </Link>
          )}
        </form>
        <nav aria-label="Filter by balance" className="flex flex-wrap gap-1.5">
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
        </nav>
      </div>

      {customers.length === 0 ? (
        <p className="empty">
          {q || filter ? "No customers match." : "No customers yet."}
        </p>
      ) : (
        <div className="card overflow-x-auto">
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
