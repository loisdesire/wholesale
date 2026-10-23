import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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
    prisma.customer.findMany({
      where,
      include: { _count: { select: { orders: true, conversations: true } } },
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.customer.count({ where }),
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
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-medium text-ink">Customers</h1>
          <p className="mt-1 text-sm text-text-muted">
            Identified by phone number, with their order and conversation history. Balances are summed from orders
            and refunds, never typed in.
          </p>
        </div>
        <Link
          href="/customers/new"
          className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-paper transition-colors hover:bg-ink-2"
        >
          New customer
        </Link>
      </header>

      <div className="flex flex-col gap-3">
        <form action="/customers" className="flex gap-2">
          {filter && <input type="hidden" name="filter" value={filter} />}
          <input
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Name, phone (any format), email, notes…"
            aria-label="Search customers"
            className="w-80 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
          />
          <button type="submit" className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-paper">
            Search
          </button>
          {(q || filter) && (
            <Link href="/customers" className="py-2 text-sm text-text-muted underline-offset-2 hover:text-ink hover:underline">
              Clear
            </Link>
          )}
        </form>
        <nav aria-label="Filter by balance" className="flex gap-1.5">
          {FILTERS.map((f) => {
            const active = filter === f.value;
            return (
              <Link
                key={f.label}
                href={link({ filter: f.value, page: undefined })}
                aria-current={active ? "true" : undefined}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  active ? "bg-ink text-paper" : "border border-line text-text-muted hover:text-ink"
                }`}
              >
                {f.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {customers.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-text-muted">
          {q || filter ? "No customers match." : "No customers yet."}
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Phone</th>
              <th className="py-2 pr-4">Notes</th>
              <th className="py-2 pr-4 text-right">Conversations</th>
              <th className="py-2 pr-4 text-right">Orders</th>
              <th className="py-2 pr-4 text-right">Owes us</th>
              <th className="py-2 pr-4 text-right">We owe</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-0">
                <td className="py-3 pr-4 text-ink">
                  <Link href={`/customers/${c.id}`} className="underline-offset-2 hover:underline">
                    {c.name ?? "Unnamed"}
                  </Link>
                </td>
                <td className="py-3 pr-4 font-tabular text-text-muted">{c.phone}</td>
                <td className="py-3 pr-4 max-w-sm truncate text-text-muted">{c.notes ?? "—"}</td>
                <td className="py-3 pr-4 text-right font-tabular text-ink">{c._count.conversations}</td>
                <td className="py-3 pr-4 text-right font-tabular text-ink">{c._count.orders}</td>
                <td className="py-3 pr-4 text-right font-tabular text-ink">
                  {formatMoney(balances.get(c.id)?.outstandingCents ?? 0)}
                </td>
                <td
                  className={`py-3 pr-4 text-right font-tabular ${
                    (balances.get(c.id)?.refundDueCents ?? 0) > 0 ? "text-status-attention-fg" : "text-ink"
                  }`}
                >
                  {formatMoney(balances.get(c.id)?.refundDueCents ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
