import Link from "next/link";
import { auth } from "@/lib/auth";
import { getAttentionItems, getOperationalMetrics, getOutOfStockProducts } from "@/lib/operations";
import { dateInput, formatRangeLabel, parseRange } from "@/lib/reports";
import { listOrganizationMembers } from "@/lib/membership";
import { formatMoney } from "@/lib/format";
import { SeverityBadge } from "@/components/status-badge";
import { AssigneeControl } from "@/components/assignee-control";
import {
  AlertCircle,
  SlidersHorizontal,
  CheckCircle2,
} from "lucide-react";

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
    <div className="flex flex-col gap-8 pb-16">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Operations Desk</h1>
          <p className="mt-1 text-sm text-text-muted">
            Overdue SLAs, bottlenecks, staff workload distribution, and turnaround metrics.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isOwner && (
            <Link
              href="/operations/settings"
              className="inline-flex h-10 items-center gap-1.5 border border-line bg-surface px-3.5 text-xs font-semibold text-ink hover:bg-paper transition-colors"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-text-muted" />
              <span>SLA thresholds</span>
            </Link>
          )}
          <Link
            href="/reports"
            className="inline-flex h-10 items-center gap-1.5 bg-accent px-4 text-xs font-semibold text-white transition-colors hover:bg-accent-2"
          >
            <span>Financial reports &amp; exports</span>
          </Link>
        </div>
      </header>

      {/* Out of Stock Alert Banner */}
      {outOfStock.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-amber-200 bg-amber-50/70 p-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 shrink-0 text-amber-800" />
            <div>
              <p className="text-xs font-bold text-amber-950">
                {outOfStock.length} active product{outOfStock.length === 1 ? " is" : "s are"} depleted &amp; out of stock
              </p>
              <p className="mt-0.5 text-xs text-amber-900/80">
                {outOfStock.slice(0, 5).map((p) => `${p.name} (${p.sku})`).join(", ")}
                {outOfStock.length > 5 ? `, and ${outOfStock.length - 5} more` : ""}
              </p>
            </div>
          </div>
          <Link
            href="/catalogue"
            className="inline-flex items-center gap-1 self-start sm:self-auto border border-amber-300 bg-surface px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100 transition-colors"
          >
            Review stock ledger
          </Link>
        </div>
      )}

      {/* Needs Attention Queue */}
      <section id="attention" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-bold text-ink">
            Action Queue {attention.length > 0 && <span className="text-text-muted font-normal text-xs font-tabular">({attention.length} items)</span>}
          </h2>
        </div>

        {attentionTruncated && (
          <p className="border border-amber-200 bg-amber-50/60 px-3.5 py-2 text-xs text-amber-900">
            High volume of overdue actions detected. Truncated to the highest priority tasks.
          </p>
        )}

        {attention.length === 0 ? (
          <div className="border border-line flex items-center gap-3.5 p-6">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700" />
            <div>
              <p className="font-semibold text-xs text-ink">Operations fully on schedule</p>
              <p className="text-xs text-text-muted">Zero orders, customer inquiries, or refunds are breaching SLA thresholds.</p>
            </div>
          </div>
        ) : (
          <div className="card-base divide-y divide-line/60 overflow-hidden">
            {attention.map((item) => (
              <div key={item.key} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 text-sm hover:bg-paper/30 transition-colors">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={item.severity} />
                    <Link href={item.href} className="font-mono text-xs font-bold text-ink hover:text-accent transition-colors">
                      {item.reference}
                    </Link>
                    {item.customer && <span className="text-xs text-text-muted">· {item.customer}</span>}
                  </div>
                  <ul className="flex flex-wrap gap-x-3 text-xs text-text-muted">
                    {item.reasons.map((r) => (
                      <li key={r} className="flex items-center gap-1.5">
                        <span className="h-1 w-1 rounded-full bg-accent" />
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex items-center gap-4 self-end sm:self-auto">
                  {item.amountCents !== null && (
                    <span className="font-tabular text-sm font-bold text-ink">
                      {formatMoney(item.amountCents)}
                    </span>
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

      {/* Operational Performance & SLA Health */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-line pb-4">
          <div>
            <h2 className="font-display text-base font-bold text-ink">Turnaround performance</h2>
            <p className="mt-0.5 text-xs text-text-muted">
              Aggregated cycle times for: <strong className="text-ink">{formatRangeLabel(range)}</strong>
            </p>
          </div>

          {/* Quick Date Presets */}
          <div className="flex flex-wrap items-center gap-2">
            {[
              { label: "7D", days: 7 },
              { label: "30D", days: 30 },
              { label: "90D", days: 90 },
            ].map((p) => {
              const toDate = new Date();
              const fromDate = new Date(toDate.getTime() - p.days * 24 * 60 * 60 * 1000);
              return (
                <Link
                  key={p.label}
                  href={rangeLink({ from: dateInput(fromDate), to: dateInput(toDate) })}
                  className="border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-text-muted hover:text-ink transition-colors"
                >
                  {p.label}
                </Link>
              );
            })}

            <form action="/operations" className="flex items-center gap-1.5 ml-1">
              <input
                name="from"
                type="date"
                defaultValue={dateInput(range.from)}
                className="border border-line bg-paper/40 px-2.5 py-1.5 text-base sm:text-xs text-ink outline-none"
              />
              <span className="text-xs text-text-muted">to</span>
              <input
                name="to"
                type="date"
                defaultValue={dateInput(range.to)}
                className="border border-line bg-paper/40 px-2.5 py-1.5 text-base sm:text-xs text-ink outline-none"
              />
              <button
                type="submit"
                className="bg-ink px-3 py-1.5 text-xs font-semibold text-paper hover:bg-ink-2 transition-colors cursor-pointer min-h-[36px]"
              >
                Go
              </button>
            </form>
          </div>
        </div>

        {/* Metrics strip — one hairline-divided row instead of identical boxed cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-line border border-line">
          {metrics.map((m) => (
            <div key={m.key} className="flex flex-col justify-between p-5">
              <div>
                <span className="text-xs text-text-muted">{m.label}</span>
                <p className="mt-2 font-tabular text-3xl font-bold text-ink">{m.value}</p>
                <p className="mt-1 text-xs text-text-muted leading-relaxed">{m.detail}</p>
              </div>
              {m.href && (
                <Link
                  href={m.href}
                  className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
                >
                  Inspect records
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Staff Workload Distribution */}
      <section className="space-y-3">
        <h2 className="font-display text-base font-bold text-ink">Staff workload balance</h2>

        {workload.length === 0 ? (
          <p className="text-xs text-text-muted">No team members registered under this organization yet.</p>
        ) : (
          <div className="card-base overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs font-medium text-text-muted">
                    <th className="py-3.5 pl-5 pr-4 min-w-[200px]">Team member</th>
                    <th className="py-3.5 pr-4 text-center w-[140px]">Open orders</th>
                    <th className="py-3.5 pr-4 text-center w-[140px]">Pending returns</th>
                    <th className="py-3.5 pl-4 pr-5 text-center w-[160px]">Active threads</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {workload.map((w) => (
                    <tr key={w.userId} className="transition-colors hover:bg-paper/30">
                      <td className="py-3.5 pl-5 pr-4 align-middle">
                        <p className="font-semibold text-ink">{w.name}</p>
                        <p className="text-xs text-text-muted">
                          {w.role === "OWNER" ? "Account owner" : "Sales staff"}
                        </p>
                      </td>
                      <td className="py-3.5 pr-4 text-center align-middle">
                        <span className="font-tabular font-bold text-ink">{w.openOrders}</span>
                      </td>
                      <td className="py-3.5 pr-4 text-center align-middle">
                        <span className="font-tabular font-bold text-ink">{w.openReturns}</span>
                      </td>
                      <td className="py-3.5 pl-4 pr-5 text-center align-middle">
                        <span className="font-tabular font-bold text-ink">{w.openConversations}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
