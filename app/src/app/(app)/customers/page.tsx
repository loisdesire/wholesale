import Link from "next/link";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { getCustomerBalances } from "@/lib/balances";
import { customerMatch } from "@/lib/search";
import { formatMoney } from "@/lib/format";
import {
  Users,
  Search,
  Plus,
  ArrowUpRight,
  X,
} from "lucide-react";

const PAGE_SIZE = 50;
const FILTERS = [
  { value: undefined, label: "All Accounts" },
  { value: "owes", label: "Owes Us (Receivables)" },
  { value: "owed", label: "Refund Due (Payables)" },
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

  // Balances are derived from actual order and refund records
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
    <div className="flex flex-col gap-6 pb-16">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Customer Directory</h1>
            <span className="rounded-full border border-line bg-paper px-2.5 py-0.5 font-tabular text-xs font-semibold text-text-muted">
              {totalCount} accounts
            </span>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            Trade counterparties, credit ledgers, and bespoke wholesale pricing tiers.
          </p>
        </div>

        <Link
          href="/customers/new"
          className="inline-flex items-center gap-2 self-start rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-xs shadow-accent/25 transition-all hover:bg-accent-2 hover:shadow-sm active:scale-95 sm:self-auto cursor-pointer"
        >
          <Plus className="h-4 w-4 stroke-[2.5]" />
          <span>New Customer</span>
        </Link>
      </header>

      {/* Search & Financial Balance Filter Card */}
      <div className="card-base flex flex-col gap-3 rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <form action="/customers" className="relative min-w-[260px] flex-1">
            {filter && <input type="hidden" name="filter" value={filter} />}
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Search by customer name, phone number, or notes…"
              className="w-full rounded-xl border border-line bg-paper/50 py-2.5 pl-10 pr-4 text-base sm:text-sm text-ink outline-none transition-all placeholder:text-text-muted/60 focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10"
            />
          </form>

          {/* Quick Balance Filter Pills */}
          <div className="flex flex-wrap items-center gap-2">
            <nav aria-label="Filter by balance" className="flex flex-wrap items-center gap-1 rounded-xl border border-line bg-paper/40 p-1">
              {FILTERS.map((f) => {
                const active = filter === f.value;
                return (
                  <Link
                    key={f.label}
                    href={link({ filter: f.value, page: undefined })}
                    aria-current={active ? "true" : undefined}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                      active
                        ? "bg-surface text-ink shadow-2xs"
                        : "text-text-muted hover:text-ink"
                    }`}
                  >
                    {f.label}
                  </Link>
                );
              })}
            </nav>

            {(q || filter) && (
              <Link
                href="/customers"
                className="inline-flex items-center gap-1 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs font-medium text-text-muted hover:text-ink hover:bg-paper transition-colors"
              >
                <X className="h-3.5 w-3.5" />
                <span>Reset</span>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Customers Table & Mobile Cards */}
      {customers.length === 0 ? (
        <div className="card-base flex flex-col items-center justify-center rounded-2xl p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-paper text-text-muted">
            <Users className="h-6 w-6" />
          </div>
          <h2 className="mt-3 font-display text-base font-bold text-ink">
            {q || filter ? "No customers match this filter" : "No customer accounts yet"}
          </h2>
          <p className="mt-1 max-w-sm text-xs text-text-muted">
            {q || filter
              ? "Try adjusting search terms or clearing the active balance filter."
              : "Customers are created automatically when they message your WhatsApp number, or you can register one manually."}
          </p>
          {!q && !filter && (
            <Link
              href="/customers/new"
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white shadow-xs"
            >
              <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
              <span>Add First Customer</span>
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Mobile Card Stack (< 640px) */}
          <div className="block sm:hidden space-y-3">
            {customers.map((c) => {
              const b = balances.get(c.id);
              const owes = b?.outstandingCents ?? 0;
              const owed = b?.refundDueCents ?? 0;

              return (
                <Link
                  key={c.id}
                  href={`/customers/${c.id}`}
                  className="card-base block rounded-2xl p-4 shadow-xs transition-colors active:bg-paper/80"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink text-base truncate">
                        {c.name ?? "Unnamed Customer"}
                      </p>
                      <p className="font-tabular text-xs text-text-muted mt-0.5">{c.phone}</p>
                    </div>

                    <ArrowUpRight className="h-4 w-4 text-text-muted shrink-0" />
                  </div>

                  {c.notes && (
                    <p className="mt-2 text-xs text-text-muted line-clamp-2 rounded-xl bg-paper/60 px-3 py-1.5">
                      {c.notes}
                    </p>
                  )}

                  {/* Badges & Balances */}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-2.5 text-xs">
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      <span className="font-tabular font-medium text-ink">
                        {c._count.orders} {c._count.orders === 1 ? "order" : "orders"}
                      </span>
                      <span>·</span>
                      <span className="font-tabular font-medium">
                        {c._count.conversations} {c._count.conversations === 1 ? "thread" : "threads"}
                      </span>
                    </div>

                    <div className="text-right">
                      {owes > 0 ? (
                        <span className="rounded-md bg-amber-500/10 px-2 py-0.5 font-tabular text-xs font-bold text-amber-800">
                          Owes {formatMoney(owes)}
                        </span>
                      ) : owed > 0 ? (
                        <span className="rounded-md bg-rose-500/10 px-2 py-0.5 font-tabular text-xs font-bold text-rose-600">
                          Refund {formatMoney(owed)}
                        </span>
                      ) : (
                        <span className="font-tabular text-xs text-text-muted/60">
                          Settled
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Desktop Table View (>= 640px) */}
          <div className="hidden sm:block card-base overflow-hidden rounded-2xl">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm table-fixed">
                <thead>
                  <tr className="border-b border-line bg-paper/60 text-xs font-semibold uppercase tracking-wider text-ink/80">
                    <th className="py-3.5 pl-5 pr-4 w-[220px]">Account Name</th>
                    <th className="py-3.5 pr-4 w-[160px]">Phone Number</th>
                    <th className="py-3.5 pr-4 min-w-[200px]">Notes</th>
                    <th className="py-3.5 pr-4 text-center w-[110px]">Threads</th>
                    <th className="py-3.5 pr-4 text-center w-[100px]">Orders</th>
                    <th className="py-3.5 pr-4 text-right w-[140px]">Owes Us</th>
                    <th className="py-3.5 pl-4 pr-5 text-right w-[140px]">We Owe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {customers.map((c) => {
                    const b = balances.get(c.id);
                    const owes = b?.outstandingCents ?? 0;
                    const owed = b?.refundDueCents ?? 0;

                    return (
                      <tr
                        key={c.id}
                        className="group transition-colors hover:bg-paper/40 cursor-pointer"
                      >
                        {/* Customer Name */}
                        <td className="py-3.5 pl-5 pr-4 align-middle">
                          <Link href={`/customers/${c.id}`} className="block">
                            <p className="font-semibold text-ink group-hover:text-accent transition-colors">
                              {c.name ?? "Unnamed Customer"}
                            </p>
                            {c.email && (
                              <p className="truncate text-xs text-text-muted">{c.email}</p>
                            )}
                          </Link>
                        </td>

                        {/* Phone */}
                        <td className="py-3.5 pr-4 align-middle font-tabular text-xs font-medium text-ink">
                          <Link href={`/customers/${c.id}`} className="group-hover:text-accent transition-colors">
                            {c.phone}
                          </Link>
                        </td>

                        {/* Notes snippet */}
                        <td className="py-3.5 pr-4 align-middle">
                          <p className="truncate text-xs text-text-muted">
                            {c.notes ?? "—"}
                          </p>
                        </td>

                        {/* Discussions Count */}
                        <td className="py-3.5 pr-4 text-center align-middle font-tabular text-xs font-medium text-text-muted">
                          {c._count.conversations}
                        </td>

                        {/* Orders Count */}
                        <td className="py-3.5 pr-4 text-center align-middle font-tabular text-xs font-semibold text-ink">
                          {c._count.orders}
                        </td>

                        {/* Owes Us */}
                        <td className="py-3.5 pr-4 text-right align-middle">
                          <span
                            className={`font-tabular text-sm font-bold ${
                              owes > 0 ? "text-amber-800" : "text-text-muted/60"
                            }`}
                          >
                            {formatMoney(owes)}
                          </span>
                        </td>

                        {/* We Owe */}
                        <td className="py-3.5 pl-4 pr-5 text-right align-middle">
                          <Link
                            href={`/customers/${c.id}`}
                            className="inline-flex items-center justify-end gap-1 font-tabular text-sm font-bold group-hover:text-accent transition-colors"
                          >
                            <span
                              className={owed > 0 ? "text-rose-600 font-bold" : "text-text-muted/60"}
                            >
                              {formatMoney(owed)}
                            </span>
                            <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100 text-accent" />
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
            Page <strong className="text-ink">{page}</strong> of {totalPages} ({totalCount} accounts)
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
