import Link from "next/link";
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

  const [attention, { metrics, workload }, outOfStock, members] = await Promise.all([
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
    <div className="flex flex-col gap-10">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-medium text-ink">Operations</h1>
          <p className="mt-1 text-sm text-text-muted">
            What needs attention right now, how the business is running, and who&apos;s carrying what.
          </p>
        </div>
        <Link href="/reports" className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-paper">
          Reports &amp; exports →
        </Link>
      </header>

      {outOfStock.length > 0 && (
        <section className="rounded-md border border-line bg-status-attention-bg px-4 py-3 text-sm">
          <p className="font-medium text-status-attention-fg">
            {outOfStock.length} active product{outOfStock.length === 1 ? " is" : "s are"} out of stock
          </p>
          <p className="mt-1 text-text-muted">
            {outOfStock
              .slice(0, 8)
              .map((p) => `${p.name} (${p.sku})`)
              .join(", ")}
            {outOfStock.length > 8 ? `, and ${outOfStock.length - 8} more` : ""} —{" "}
            <Link href="/catalogue" className="underline underline-offset-2">
              review the catalogue
            </Link>
            .
          </p>
        </section>
      )}

      <section id="attention">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-ink">
            Needs attention {attention.length > 0 && <span className="text-text-muted">({attention.length})</span>}
          </h2>
        </div>
        {attention.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-text-muted">
            Nothing is overdue right now.
          </p>
        ) : (
          <div className="divide-y divide-line rounded-md border border-line bg-surface">
            {attention.map((item) => (
              <div key={item.key} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={item.severity} />
                    <Link href={item.href} className="font-tabular text-ink underline-offset-2 hover:underline">
                      {item.reference}
                    </Link>
                    {item.customer && <span className="text-text-muted">{item.customer}</span>}
                  </div>
                  <ul className="mt-1 flex flex-col gap-0.5 text-xs text-text-muted">
                    {item.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {item.amountCents !== null && (
                    <span className="font-tabular text-ink">{formatMoney(item.amountCents)}</span>
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
          <h2 className="text-sm font-medium text-ink">
            Performance — {formatRangeLabel(range)}
          </h2>
          <form action="/operations" className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              From
              <input name="from" type="date" defaultValue={dateInput(range.from)} className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              To
              <input name="to" type="date" defaultValue={dateInput(range.to)} className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink" />
            </label>
            <button type="submit" className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-paper">
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
                className="rounded-full border border-line px-3 py-1 text-text-muted hover:text-ink"
              >
                {p.label}
              </Link>
            );
          })}
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {metrics.map((m) => (
            <div key={m.key} className="bg-surface p-4">
              <dt className="text-xs text-text-muted">{m.label}</dt>
              <dd className="mt-1 font-tabular text-2xl font-medium text-ink">{m.value}</dd>
              <p className="mt-1 text-xs text-text-muted">{m.detail}</p>
              {m.href && (
                <Link href={m.href} className="mt-2 inline-block text-xs text-ink underline underline-offset-2">
                  See records →
                </Link>
              )}
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink">Workload</h2>
        {workload.length === 0 ? (
          <p className="text-sm text-text-muted">No team members yet.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
                <th className="py-2 pr-4">Person</th>
                <th className="py-2 pr-4 text-right">Open orders</th>
                <th className="py-2 pr-4 text-right">Open returns</th>
                <th className="py-2 pr-4 text-right">Open conversations</th>
              </tr>
            </thead>
            <tbody>
              {workload.map((w) => (
                <tr key={w.userId} className="border-b border-line last:border-0">
                  <td className="py-3 pr-4 text-ink">
                    {w.name} <span className="text-xs text-text-muted">{w.role === "OWNER" ? "Owner" : "Staff"}</span>
                  </td>
                  <td className="py-3 pr-4 text-right font-tabular text-ink">{w.openOrders}</td>
                  <td className="py-3 pr-4 text-right font-tabular text-ink">{w.openReturns}</td>
                  <td className="py-3 pr-4 text-right font-tabular text-ink">{w.openConversations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
