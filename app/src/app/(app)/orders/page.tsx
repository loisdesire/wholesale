import Link from "next/link";
import { Plus, Search, SlidersHorizontal } from "lucide-react";
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
    <div className="flex flex-col gap-5">
      <header className="page-head">
        <h1 className="page-title">Orders</h1>
        <Link href="/orders/new" className="btn btn-primary">
          <Plus size={16} strokeWidth={2.4} />
          New order
        </Link>
      </header>

      {/* Filters sit on the canvas in three quiet layers: search, one scrolling line of status
          chips, and the rarely-used date/assignee filters behind a disclosure. */}
      <form action="/orders" className="flex flex-col gap-3">
        {filters.status && <input type="hidden" name="status" value={filters.status} />}
        <div className="relative max-w-md">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            name="q"
            type="search"
            defaultValue={filters.q}
            placeholder="Search orders"
            aria-label="Search orders by reference, customer, phone or product"
            className="input w-full pl-9"
          />
        </div>
        <nav aria-label="Filter by status" className="chip-row">
          {STATUS_FILTERS.map((f) => {
            const active = filters.status === f.value;
            return (
              <Link
                key={f.label}
                href={link({ status: f.value, page: undefined })}
                aria-current={active ? "true" : undefined}
                className={`chip ${active ? "chip-active" : ""}`}
              >
                {f.label}
              </Link>
            );
          })}
        </nav>
        <details className="text-sm" open={Boolean(filters.from || filters.to || filters.assignee)}>
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 font-medium text-text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
            <SlidersHorizontal size={14} />
            Date &amp; assignee
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs text-text-muted">
                From
                <input name="from" type="date" defaultValue={filters.from} className="input input-sm" />
              </label>
              <label className="flex flex-col gap-1 text-xs text-text-muted">
                To
                <input name="to" type="date" defaultValue={filters.to} className="input input-sm" />
              </label>
              <button type="submit" className="btn btn-secondary btn-sm">
                Apply
              </button>
            </div>
            <nav aria-label="Filter by assignee" className="chip-row">
              {[{ value: undefined, label: "Anyone" }, { value: "none", label: "Unassigned" }, ...members.map((m) => ({ value: m.id, label: m.name }))].map((f) => {
                const active = filters.assignee === f.value;
                return (
                  <Link
                    key={f.label}
                    href={link({ assignee: f.value, page: undefined })}
                    aria-current={active ? "true" : undefined}
                    className={`chip ${active ? "chip-active" : ""}`}
                  >
                    {f.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </details>
        {filtered && (
          <p className="text-xs text-text-muted">
            {totalCount} {totalCount === 1 ? "order matches" : "orders match"} ·{" "}
            <Link href="/orders" className="link">
              Clear filters
            </Link>
          </p>
        )}
      </form>

      {orders.length === 0 && filtered ? (
        <p className="empty">
          No orders match these filters.
        </p>
      ) : orders.length === 0 ? (
        <p className="empty">
          No orders yet.{" "}
          <Link href="/orders/new" className="link">
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
