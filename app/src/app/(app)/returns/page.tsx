import Link from "next/link";
import { ReturnStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { formatDateTime, formatMoney } from "@/lib/format";
import { RefundStatusBadge, ReturnStatusBadge } from "@/components/status-badge";

const PAGE_SIZE = 40;
const FILTERS = [
  { value: undefined, label: "All" },
  { value: "REQUESTED", label: "Awaiting decision" },
  { value: "APPROVED", label: "Approved" },
  { value: "RECEIVED", label: "Received" },
  { value: "REJECTED", label: "Rejected" },
] as const;
const KIND_LABEL: Record<string, string> = { RETURN: "Return", CANCELLATION: "Cancelled after payment", UNSHIPPED: "Closed short" };

export const metadata = { title: "Returns" };

/** Accepts only a plain YYYY-MM-DD; anything else is ignored rather than breaking the page. */
function parseDay(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; from?: string; to?: string; page?: string }>;
}) {
  const params = await searchParams;
  const session = await auth();
  const organizationId = session!.user.organizationId;
  const db = tenantDb(organizationId);

  const status = FILTERS.some((f) => f.value === params.status) ? (params.status as ReturnStatus) : undefined;
  const from = parseDay(params.from);
  const to = parseDay(params.to, true);
  const page = Math.max(1, Math.floor(Number(params.page)) || 1);

  const where = {
    organizationId,
    ...(status ? { status } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
  const [returns, totalCount] = await Promise.all([
    db.orderReturn.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { customer: { select: { name: true, phone: true } }, order: { select: { id: true, reference: true } } },
    }),
    db.orderReturn.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const link = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ status, from: params.from, to: params.to, ...overrides })) if (value) next.set(key, value);
    const qs = next.toString();
    return qs ? `/returns?${qs}` : "/returns";
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="page-head">
        <div>
          <Link href="/operations" className="back-link">
            ← Operations
          </Link>
          <h1 className="page-title mt-1">Returns and refunds</h1>
          {(from || to) && (
            <p className="mt-1 text-sm text-text-muted">
              {params.from ?? "…"} to {params.to ?? "…"} ·{" "}
              <Link href={link({ from: undefined, to: undefined, page: undefined })} className="link">
                Show all dates
              </Link>
            </p>
          )}
        </div>
      </header>

      <nav aria-label="Filter by status" className="chip-row">
        {FILTERS.map((f) => {
          const active = status === f.value;
          return (
            <Link key={f.label} href={link({ status: f.value, page: undefined })} aria-current={active ? "true" : undefined} className={`chip ${active ? "chip-active" : ""}`}>
              {f.label}
            </Link>
          );
        })}
      </nav>

      {returns.length === 0 ? (
        <p className="empty">No returns{status || from || to ? " match these filters" : " yet"}.</p>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {returns.map((r) => (
            <li key={r.id}>
              <Link href={`/orders/${r.order.id}`} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-paper/70 sm:px-5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    <span className="font-mono">{r.reference}</span> · {r.customer.name ?? r.customer.phone}
                  </p>
                  <p className="mt-0.5 text-sm text-text-muted">
                    {KIND_LABEL[r.kind] ?? r.kind} on <span className="font-mono">{r.order.reference}</span> — {r.reason}
                  </p>
                  <p className="mt-0.5 text-xs text-text-muted">{formatDateTime(r.createdAt)}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className="font-tabular text-sm font-semibold text-ink">{formatMoney(r.refundCents)}</span>
                  <span className="flex flex-wrap items-center justify-end gap-1.5">
                    <ReturnStatusBadge status={r.status} />
                    {r.refundStatus !== "NONE" && <RefundStatusBadge status={r.refundStatus} />}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
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
