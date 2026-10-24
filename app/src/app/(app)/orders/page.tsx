import Link from "next/link";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { buildOrderWhere, parseOrderStatus } from "@/lib/search";
import { listOrganizationMembers } from "@/lib/membership";
import { OrdersTable, type OrderRow } from "./orders-table";

const PAGE_SIZE = 50;
const STATUS_FILTERS = [
  { value: undefined, label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "PAID", label: "Paid" },
  { value: "PARTIALLY_FULFILLED", label: "Partly shipped" },
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
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-medium text-ink">Orders</h1>
          <p className="mt-1 text-sm text-text-muted">
            Draft, confirmed, paid, and fulfilled — every order in one place.
          </p>
        </div>
        <Link
          href="/orders/new"
          className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-paper transition-colors hover:bg-ink-2"
        >
          New order
        </Link>
      </header>

      <div className="flex flex-col gap-3">
        <form action="/orders" className="flex flex-wrap items-end gap-2">
          {filters.status && <input type="hidden" name="status" value={filters.status} />}
          <input
            name="q"
            type="search"
            defaultValue={filters.q}
            placeholder="Reference, customer, phone, product…"
            aria-label="Search orders"
            className="w-72 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
          />
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            From
            <input
              name="from"
              type="date"
              defaultValue={filters.from}
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            To
            <input
              name="to"
              type="date"
              defaultValue={filters.to}
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <button type="submit" className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-paper">
            Apply
          </button>
          {filtered && (
            <Link href="/orders" className="py-2 text-sm text-text-muted underline-offset-2 hover:text-ink hover:underline">
              Clear
            </Link>
          )}
        </form>
        <nav aria-label="Filter by status" className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((f) => {
            const active = filters.status === f.value;
            return (
              <Link
                key={f.label}
                href={link({ status: f.value, page: undefined })}
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
        <nav aria-label="Filter by assignee" className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-text-muted">Assigned:</span>
          {[{ value: undefined, label: "Anyone" }, { value: "none", label: "Unassigned" }, ...members.map((m) => ({ value: m.id, label: m.name }))].map((f) => {
            const active = filters.assignee === f.value;
            return (
              <Link
                key={f.label}
                href={link({ assignee: f.value, page: undefined })}
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
        {filtered && (
          <p className="text-xs text-text-muted">
            {totalCount} {totalCount === 1 ? "order matches" : "orders match"}
          </p>
        )}
      </div>

      {orders.length === 0 && filtered ? (
        <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-text-muted">
          No orders match these filters.
        </p>
      ) : orders.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-text-muted">
          No orders yet.{" "}
          <Link href="/orders/new" className="text-ink underline underline-offset-2">
            Create the first one
          </Link>
          .
        </p>
      ) : (
        <OrdersTable orders={rows} members={members} canBulkAssign={isOwner} />
      )}

      {totalPages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={link({ page: String(page - 1) })} className="text-ink underline-offset-2 hover:underline">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-text-muted">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={link({ page: String(page + 1) })} className="text-ink underline-offset-2 hover:underline">
              Older →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
