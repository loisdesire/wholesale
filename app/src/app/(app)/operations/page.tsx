import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { auth } from "@/lib/auth";
import { getAttentionItems, getOperationalMetrics, getOutOfStockProducts } from "@/lib/operations";
import { dateInput, formatRangeLabel, parseRange } from "@/lib/reports";
import { listOrganizationMembers } from "@/lib/membership";
import { formatMoney } from "@/lib/format";
import { SeverityBadge } from "@/components/status-badge";
import { AssigneeControl } from "@/components/assignee-control";

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from, to } = await searchParams;
  const session = await auth();
  const organizationId = session!.user.organizationId;
  const isOwner = session!.user.role === "OWNER";
  const range = parseRange(from, to);

  const [{ items: attention, truncated: attentionTruncated }, { metrics, workload }, outOfStock, members] = await Promise.all([
    getAttentionItems(organizationId),
    getOperationalMetrics(organizationId, range),
    getOutOfStockProducts(organizationId),
    listOrganizationMembers(organizationId),
  ]);

  const rangeLink = (overrides: Record<string, string>) => {
    const next = new URLSearchParams({ from: dateInput(range.from), to: dateInput(range.to), ...overrides });
    return `/operations?${next.toString()}`;
  };

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="page-title">Operations</h1>
          <p className="mt-1 text-sm text-text-muted">
            What needs attention right now, how the business is running, and who&apos;s carrying what.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isOwner && (
            <Link href="/operations/settings" className="btn btn-secondary">
              Thresholds
            </Link>
          )}
          <Link href="/reports" className="btn btn-secondary">
            Reports &amp; exports →
          </Link>
        </div>
      </header>

      {outOfStock.length > 0 && (
        <section className="rounded-xl border border-status-attention-fg/20 bg-status-attention-bg px-4 py-3 text-sm">
          <p className="font-medium text-status-attention-fg">
            {outOfStock.length} active product{outOfStock.length === 1 ? " is" : "s are"} out of stock
          </p>
          <p className="mt-1 text-text-muted">
            {outOfStock
              .slice(0, 8)
              .map((p) => `${p.name} (${p.sku})`)
              .join(", ")}
            {outOfStock.length > 8 ? `, and ${outOfStock.length - 8} more` : ""} —{" "}
            <Link href="/catalogue" className="font-medium text-ink underline underline-offset-2">
              review the catalogue
            </Link>
            .
          </p>
        </section>
      )}

      <section id="attention">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="section-title">
            Needs attention {attention.length > 0 && <span className="text-text-muted">({attention.length})</span>}
          </h2>
        </div>
        {attentionTruncated && (
          <p className="mb-3 rounded-xl border border-status-attention-fg/20 bg-status-attention-bg px-3 py-2 text-xs text-status-attention-fg">
            At least one category below has more overdue items than fit here — some aren&apos;t shown. Clear the ones
            you see and check back, rather than assuming this is everything.
          </p>
        )}
        {attention.length === 0 ? (
          <p className="empty">
            Nothing is overdue right now.
          </p>
        ) : (
          <div className="card divide-y divide-line overflow-hidden">
            {attention.map((item) => (
              <div key={item.key} className="relative flex flex-col gap-3 px-5 py-3.5 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-0 left-0 w-[3px] ${
                    item.severity === "critical" ? "bg-status-attention-fg" : item.severity === "warning" ? "bg-[#f0a41c]" : "bg-line-strong"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={item.severity} />
                    <Link href={item.href} className="font-semibold text-ink underline-offset-4 hover:text-accent hover:underline">
                      {item.reference}
                    </Link>
                    {item.customer && <span className="text-text-muted">{item.customer}</span>}
                  </div>
                  <ul className="mt-1.5 flex flex-col gap-0.5 text-[13px] text-text-muted">
                    {item.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
                <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:gap-2">
                  {item.amountCents !== null && (
                    <span className="font-tabular font-semibold text-ink">{formatMoney(item.amountCents)}</span>
                  )}
                  <AssigneeControl
                    kind={item.kind}
                    id={item.id}
                    currentAssigneeId={item.assignee?.id ?? null}
                    members={members}
                    isOwner={isOwner}
                    currentUserId={session!.user.id}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="section-title">
            Performance — {formatRangeLabel(range)}
          </h2>
          <form action="/operations" className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              From
              <input name="from" type="date" defaultValue={dateInput(range.from)} className="input input-sm" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              To
              <input name="to" type="date" defaultValue={dateInput(range.to)} className="input input-sm" />
            </label>
            <button type="submit" className="btn btn-secondary">
              Apply
            </button>
          </form>
        </div>
        <div className="flex gap-1.5 text-xs">
          {[
            { label: "Last 7 days", days: 7 },
            { label: "Last 30 days", days: 30 },
            { label: "Last 90 days", days: 90 },
          ].map((p) => {
            const to = new Date();
            const from = new Date(to.getTime() - p.days * 24 * 60 * 60 * 1000);
            return (
              <Link
                key={p.label}
                href={rangeLink({ from: dateInput(from), to: dateInput(to) })}
                className="chip"
              >
                {p.label}
              </Link>
            );
          })}
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {metrics.map((m) => (
            <div key={m.key} className="card flex flex-col p-5">
              <dt className="eyebrow">{m.label}</dt>
              <dd className="mt-2 font-display text-4xl font-bold leading-none tracking-tight text-ink">{m.value}</dd>
              <p className="mt-2.5 text-xs leading-relaxed text-text-muted">{m.detail}</p>
              {m.href && (
                <Link href={m.href} className="link mt-auto inline-block pt-3 text-xs">
                  See records →
                </Link>
              )}
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h2 className="section-title mb-3">Workload</h2>
        {workload.length === 0 ? (
          <p className="text-sm text-text-muted">No team members yet.</p>
        ) : (
          // Workload as bars, not a grid of numbers: who is carrying the most is visible before
          // any figure is read. Bars share one scale (the busiest person = full width).
          <div className="card divide-y divide-line">
            {workload.map((w) => {
              const total = w.openOrders + w.openReturns + w.openConversations;
              const max = Math.max(1, ...workload.map((x) => x.openOrders + x.openReturns + x.openConversations));
              return (
                <div key={w.userId} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-6">
                  <div className="flex items-center gap-3 sm:w-56 sm:shrink-0">
                    <Avatar name={w.name} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{w.name}</p>
                      <p className="text-xs text-text-muted">{w.role === "OWNER" ? "Owner" : "Staff"}</p>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex h-2.5 overflow-hidden rounded-full bg-paper" aria-hidden="true">
                      <div className="flex h-full gap-0.5" style={{ width: `${(total / max) * 100}%` }}>
                        {w.openOrders > 0 && <span className="rounded-full bg-accent" style={{ flexGrow: w.openOrders, flexBasis: 0 }} />}
                        {w.openReturns > 0 && <span className="rounded-full bg-[#f0a41c]" style={{ flexGrow: w.openReturns, flexBasis: 0 }} />}
                        {w.openConversations > 0 && <span className="rounded-full bg-[#18a66a]" style={{ flexGrow: w.openConversations, flexBasis: 0 }} />}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-muted">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-accent" />
                        <span className="font-tabular font-semibold text-ink">{w.openOrders}</span> open orders
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-[#f0a41c]" />
                        <span className="font-tabular font-semibold text-ink">{w.openReturns}</span> open returns
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-[#18a66a]" />
                        <span className="font-tabular font-semibold text-ink">{w.openConversations}</span> open conversations
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
