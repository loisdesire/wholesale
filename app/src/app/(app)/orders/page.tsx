import Link from "next/link";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { buildOrderWhere, parseOrderStatus } from "@/lib/search";
import { listOrganizationMembers } from "@/lib/membership";
import { OrdersTable, type OrderRow } from "./orders-table";
import { Plus, Search, X } from "lucide-react";

const PAGE_SIZE = 50;
const STATUS_FILTERS = [
  { value: undefined, label: "All Orders" },
  { value: "DRAFT", label: "Draft" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "PAID", label: "Paid" },
  { value: "PARTIALLY_FULFILLED", label: "Partly Shipped" },
  { value: "FULFILLED", label: "Fulfilled" },
  { value: "CANCELLED", label: "Cancelled" },
] as const;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; from?: string; to?: string; page?: string; assignee?: string }>;
}) {
  const params = await searchParams;
  const session = await auth();
  const organizationId = session!.user.organizationId;
  const isOwner = session!.user.role === "OWNER";
  const db = tenantDb(organizationId);

  const filters = {
    q: params.q?.trim() || undefined,
    status: parseOrderStatus(params.status),
    from: params.from || undefined,
    to: params.to || undefined,
    assignee: params.assignee || undefined,
  };
  const where = buildOrderWhere(organizationId, filters);
  const page = Math.max(1, Number(params.page) || 1);
  const filtered = Boolean(filters.q || filters.status || filters.from || filters.to || filters.assignee);

  const [orders, totalCount, members] = await Promise.all([
    db.order.findMany({
      where,
      include: { customer: true, items: true, assignedTo: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.order.count({ where }),
    listOrganizationMembers(organizationId),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const link = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { q: filters.q, status: filters.status, from: filters.from, to: filters.to, assignee: filters.assignee, ...overrides };
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
    const qs = next.toString();
    return qs ? `/orders?${qs}` : "/orders";
  };
  const rows: OrderRow[] = orders.map((o) => ({
    id: o.id,
    reference: o.reference,
    customerName: o.customer.name,
    customerPhone: o.customer.phone,
    units: o.items.reduce((sum, i) => sum + i.quantity, 0),
    status: o.status,
    createdAt: o.createdAt,
    totalCents: o.totalCents,
    currency: o.currency,
    assignedToName: o.assignedTo?.name ?? null,
  }));

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-baseline gap-2.5">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Orders Ledger</h1>
            <span className="font-tabular text-sm text-text-muted">{totalCount} total</span>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            Trade commitments, dispatch manifests, and live customer orders.
          </p>
        </div>
        <Link
          href="/orders/new"
          className="inline-flex h-10 items-center gap-2 self-start bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-2 sm:self-auto cursor-pointer"
        >
          <Plus className="h-4 w-4 stroke-[2.5]" />
          <span>New Order</span>
        </Link>
      </header>

      {/* Filter & Search Bar */}
      <div className="border border-line flex flex-col gap-3 p-4 sm:p-5">
        <form action="/orders" className="flex flex-wrap items-center gap-3">
          {filters.status && <input type="hidden" name="status" value={filters.status} />}

          <div className="relative min-w-[260px] flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              name="q"
              type="search"
              defaultValue={filters.q}
              placeholder="Search reference, customer name, phone, product…"
              className="w-full border border-line bg-paper/50 py-2.5 pl-10 pr-4 text-base sm:text-sm text-ink outline-none transition-all placeholder:text-text-muted/60 focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 border border-line bg-paper/40 px-3 py-1.5 text-xs text-text-muted">
              <span className="font-medium text-ink/80">From</span>
              <input
                name="from"
                type="date"
                defaultValue={filters.from}
                className="bg-transparent text-base sm:text-xs font-medium text-ink outline-none"
              />
            </div>

            <div className="flex items-center gap-1.5 border border-line bg-paper/40 px-3 py-1.5 text-xs text-text-muted">
              <span className="font-medium text-ink/80">To</span>
              <input
                name="to"
                type="date"
                defaultValue={filters.to}
                className="bg-transparent text-base sm:text-xs font-medium text-ink outline-none"
              />
            </div>

            <button
              type="submit"
              className="h-9 bg-ink px-4 text-xs font-semibold text-paper hover:bg-ink-2 transition-colors cursor-pointer"
            >
              Filter
            </button>

            {filtered && (
              <Link
                href="/orders"
                className="inline-flex items-center gap-1 border border-line px-3 py-2 text-xs font-medium text-text-muted hover:text-ink hover:bg-paper transition-colors"
              >
                <X className="h-3.5 w-3.5" />
                <span>Reset</span>
              </Link>
            )}
          </div>
        </form>

        {/* Status Filter Tab Ribbon — plain underline tabs, not filled pills */}
        <nav aria-label="Filter by status" className="flex flex-wrap items-center gap-5 border-t border-line/60 pt-3 text-xs font-semibold">
          {STATUS_FILTERS.map((f) => {
            const active = filters.status === f.value;
            return (
              <Link
                key={f.label}
                href={link({ status: f.value, page: undefined })}
                aria-current={active ? "true" : undefined}
                className={`border-b-2 pb-0.5 transition-colors ${
                  active ? "border-accent text-ink" : "border-transparent text-text-muted hover:text-ink"
                }`}
              >
                {f.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Main Table Card View */}
      <OrdersTable orders={rows} members={members} canBulkAssign={isOwner} />

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2 pt-2 text-xs text-text-muted">
          <span>
            Page <strong className="text-ink">{page}</strong> of {totalPages}
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
