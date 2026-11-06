import Link from "next/link";
import { auth } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import {
  dateInput,
  formatRangeLabel,
  getOutstandingBalances,
  getProductDemand,
  getSalesReport,
  getStockMovementSummary,
  parseRange,
} from "@/lib/reports";
import { listReportViews } from "@/lib/report-views";
import { SavedViews } from "./saved-views";
import {
  Download,
  ArrowDownLeft,
  ArrowUpRight,
} from "lucide-react";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from, to } = await searchParams;
  const session = await auth();
  const organizationId = session!.user.organizationId;
  const range = parseRange(from, to);
  const qs = `from=${dateInput(range.from)}&to=${dateInput(range.to)}`;

  const [sales, demand, stockMovements, outstanding, savedViews] = await Promise.all([
    getSalesReport(organizationId, range),
    getProductDemand(organizationId, range),
    getStockMovementSummary(organizationId, range),
    getOutstandingBalances(organizationId),
    listReportViews(organizationId),
  ]);

  return (
    <div className="flex flex-col gap-8 pb-16">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Reports &amp; Analytics</h1>
            <span className="rounded-full border border-line bg-paper px-2.5 py-0.5 font-tabular text-xs font-semibold text-text-muted">
              Financial Audit
            </span>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            Live sales revenue, verified cash reconciliation, SKU demand, and stock movement reports for <strong className="text-ink">{formatRangeLabel(range)}</strong>.
          </p>
        </div>

        <Link
          href="/operations"
          className="inline-flex items-center gap-1.5 self-start rounded-xl border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-ink shadow-2xs hover:bg-paper transition-colors sm:self-auto cursor-pointer"
        >
          <span>← Back to Operations Desk</span>
        </Link>
      </header>

      {/* Date Range Controls & Saved Views Card */}
      <div className="card-base flex flex-col gap-3 rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form action="/reports" className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-1.5 rounded-xl border border-line bg-paper/40 px-3 py-1.5">
              <span className="font-semibold uppercase tracking-wider text-xs text-text-muted">From</span>
              <input
                name="from"
                type="date"
                defaultValue={dateInput(range.from)}
                className="bg-transparent font-medium text-ink outline-none text-base sm:text-xs"
              />
            </div>
            <div className="flex items-center gap-1.5 rounded-xl border border-line bg-paper/40 px-3 py-1.5">
              <span className="font-semibold uppercase tracking-wider text-xs text-text-muted">To</span>
              <input
                name="to"
                type="date"
                defaultValue={dateInput(range.to)}
                className="bg-transparent font-medium text-ink outline-none text-base sm:text-xs"
              />
            </div>
            <button
              type="submit"
              className="inline-flex min-h-[40px] items-center justify-center rounded-xl bg-ink px-4 py-2 font-semibold text-paper hover:bg-ink-2 transition-colors cursor-pointer"
            >
              Apply Filter
            </button>
          </form>

          {/* Quick Preset Links */}
          <div className="flex items-center gap-1.5">
            {[
              { label: "This Month", days: 30 },
              { label: "Quarter", days: 90 },
              { label: "Year to Date", days: 365 },
            ].map((p) => {
              const toDate = new Date();
              const fromDate = new Date(toDate.getTime() - p.days * 24 * 60 * 60 * 1000);
              return (
                <Link
                  key={p.label}
                  href={`/reports?from=${dateInput(fromDate)}&to=${dateInput(toDate)}`}
                  className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-text-muted hover:text-ink hover:bg-paper/40 transition-colors"
                >
                  {p.label}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Saved Report Views Component */}
        <div className="border-t border-line/60 pt-3">
          <SavedViews views={savedViews} from={dateInput(range.from)} to={dateInput(range.to)} rangeLabel={formatRangeLabel(range)} />
        </div>
      </div>

      {/* 1. Re-architected: Sales & Cash Reconciliation */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-ink">Sales &amp; Cash Reconciliation</h2>
            <p className="text-xs text-text-muted">Comparing confirmed order commitments against verified cash settlements.</p>
          </div>
          <a
            href={`/api/reports?report=sales&${qs}`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-paper shadow-2xs transition-colors"
          >
            <Download className="h-3.5 w-3.5 text-text-muted" />
            <span>Export Sales CSV</span>
          </a>
        </div>

        {/* Primary Hero Financial Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          {/* Confirmed Order Volume */}
          <div className="card-base flex flex-col justify-between rounded-2xl p-5 shadow-xs">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink/80">
              Sales Commitment
            </span>
            <div className="mt-3">
              <p className="font-tabular text-3xl font-bold tracking-tight text-ink">
                {formatMoney(sales.orderValueCents)}
              </p>
              <div className="mt-2 flex items-center justify-between border-t border-line/60 pt-2 text-xs">
                <span className="text-text-muted">{sales.orderCount} orders confirmed</span>
                <span className="font-tabular font-medium text-ink">
                  Avg {sales.averageOrderValueCents === null ? "—" : formatMoney(sales.averageOrderValueCents)}
                </span>
              </div>
            </div>
          </div>

          {/* Actual Cash Received & Flow */}
          <div className="card-base flex flex-col justify-between rounded-2xl p-5 shadow-xs">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink/80">
              Net Period Cash
            </span>
            <div className="mt-3">
              <p className="font-tabular text-3xl font-bold tracking-tight text-emerald-700">
                {formatMoney(sales.netCashCents)}
              </p>
              <div className="mt-2 flex items-center justify-between border-t border-line/60 pt-2 text-xs font-tabular">
                <span className="text-emerald-700 font-medium">+{formatMoney(sales.cashReceivedCents)} in</span>
                <span className="text-rose-600 font-medium">-{formatMoney(sales.refundsPaidCents)} out</span>
              </div>
            </div>
          </div>

          {/* Gross Margin & Cost Coverage */}
          <div className="card-base flex flex-col justify-between rounded-2xl p-5 shadow-xs">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink/80">
              Gross Product Margin
            </span>
            <div className="mt-3">
              <p className="font-tabular text-3xl font-bold tracking-tight text-ink">
                {sales.margin ? formatMoney(sales.margin.marginCents) : "—"}
              </p>
              <div className="mt-2 border-t border-line/60 pt-2 text-xs text-text-muted">
                {sales.margin ? (
                  <div className="flex items-center justify-between">
                    <span>Coverage on items</span>
                    <span className="font-semibold text-ink font-tabular">
                      {sales.margin.coveragePercent.toFixed(0)}% ({sales.margin.linesWithCost}/{sales.margin.lines} lines)
                    </span>
                  </div>
                ) : (
                  <span>Product costs not entered yet</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Settlement Balance Breakdown */}
        <div className="card-base rounded-2xl p-5 shadow-xs">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink/80 mb-3">
            Current Settlement Status (Open Balances)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-line/70">
            {/* Receivables Due */}
            <div className="pb-3 sm:pb-0 sm:pr-6 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-bold text-ink">
                  <ArrowDownLeft className="h-3.5 w-3.5 text-amber-600" />
                  <span>Unpaid Receivables (Owed to Us)</span>
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  Value of confirmed orders that have not yet been marked paid.
                </p>
              </div>
              <span className="font-tabular text-xl font-bold text-amber-800">
                {formatMoney(sales.receivablesCents)}
              </span>
            </div>

            {/* Refunds Pending Payout */}
            <div className="pt-3 sm:pt-0 sm:pl-6 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-bold text-ink">
                  <ArrowUpRight className="h-3.5 w-3.5 text-rose-600" />
                  <span>Pending Refunds (Owed by Us)</span>
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  Customer returns or cancellations approved but not yet paid out.
                </p>
              </div>
              <span
                className={`font-tabular text-xl font-bold ${
                  sales.refundsOwedCents > 0 ? "text-rose-600" : "text-text-muted"
                }`}
              >
                {formatMoney(sales.refundsOwedCents)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 2-Column Responsive Reports Grid: Product Demand & Outstanding Balances */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Product Demand Table Card */}
        <div className="card-base overflow-hidden rounded-2xl shadow-xs">
          <div className="flex items-center justify-between border-b border-line bg-paper/40 px-5 py-3.5">
            <h2 className="font-display text-sm font-bold text-ink">SKU Volume &amp; Demand</h2>
            <a
              href={`/api/reports?report=demand&${qs}`}
              className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
            >
              <Download className="h-3 w-3" />
              <span>CSV</span>
            </a>
          </div>

          {demand.length === 0 ? (
            <p className="p-8 text-center text-xs text-text-muted">No confirmed orders in this period.</p>
          ) : (
            <div className="overflow-x-auto max-h-[420px]">
              <table className="w-full border-collapse text-left text-sm table-fixed">
                <thead>
                  <tr className="border-b border-line bg-paper/20 text-xs font-semibold uppercase tracking-wider text-ink/80">
                    <th className="py-3 pl-5 pr-4 min-w-[160px]">Product Specification</th>
                    <th className="py-3 pr-4 text-center w-[90px]">Units</th>
                    <th className="py-3 pr-4 text-center w-[80px]">Orders</th>
                    <th className="py-3 pr-5 text-right w-[120px]">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60 text-xs">
                  {demand.map((d) => (
                    <tr key={d.productId} className="transition-colors hover:bg-paper/20">
                      <td className="py-3 pl-5 pr-4 align-middle">
                        <Link href={`/catalogue/${d.productId}`} className="font-semibold text-ink hover:text-accent transition-colors">
                          {d.name}
                        </Link>
                        <p className="font-mono text-xs text-text-muted">{d.sku}</p>
                      </td>
                      <td className="py-3 pr-4 text-center font-tabular font-bold text-ink align-middle">
                        {d.units}
                      </td>
                      <td className="py-3 pr-4 text-center font-tabular text-text-muted align-middle">
                        {d.orders}
                      </td>
                      <td className="py-3 pr-5 text-right font-tabular font-bold text-ink align-middle">
                        {formatMoney(d.revenueCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Outstanding Customer Balances Card */}
        <div className="card-base overflow-hidden rounded-2xl shadow-xs">
          <div className="flex items-center justify-between border-b border-line bg-paper/40 px-5 py-3.5">
            <h2 className="font-display text-sm font-bold text-ink">Outstanding Balances (Live)</h2>
            <a
              href="/api/reports?report=outstanding"
              className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
            >
              <Download className="h-3 w-3" />
              <span>CSV</span>
            </a>
          </div>

          {outstanding.length === 0 ? (
            <p className="p-8 text-center text-xs text-text-muted">All customer accounts are fully settled.</p>
          ) : (
            <div className="overflow-x-auto max-h-[420px]">
              <table className="w-full border-collapse text-left text-sm table-fixed">
                <thead>
                  <tr className="border-b border-line bg-paper/20 text-xs font-semibold uppercase tracking-wider text-ink/80">
                    <th className="py-3 pl-5 pr-4 min-w-[160px]">Customer</th>
                    <th className="py-3 pr-4 text-right w-[110px]">Owes Us</th>
                    <th className="py-3 pr-4 text-right w-[110px]">We Owe</th>
                    <th className="py-3 pr-5 text-right w-[110px]">Net Position</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60 text-xs">
                  {outstanding.map((r) => (
                    <tr key={r.customerId} className="transition-colors hover:bg-paper/20">
                      <td className="py-3 pl-5 pr-4 align-middle">
                        <Link href={`/customers/${r.customerId}`} className="font-semibold text-ink hover:text-accent transition-colors">
                          {r.name}
                        </Link>
                        <p className="font-tabular text-xs text-text-muted">{r.phone}</p>
                      </td>
                      <td className="py-3 pr-4 text-right font-tabular font-bold text-amber-800 align-middle">
                        {r.owesUsCents > 0 ? formatMoney(r.owesUsCents) : "—"}
                      </td>
                      <td className={`py-3 pr-4 text-right font-tabular font-bold align-middle ${r.weOweCents > 0 ? "text-rose-600" : "text-text-muted"}`}>
                        {r.weOweCents > 0 ? formatMoney(r.weOweCents) : "—"}
                      </td>
                      <td className="py-3 pr-5 text-right font-tabular font-bold text-ink align-middle">
                        {formatMoney(r.netCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 3. Stock Movement Summary Ledger */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-bold text-ink">Ledger Stock Movement Net Flow</h2>
          <a
            href={`/api/reports?report=stock&${qs}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink hover:bg-paper transition-colors"
          >
            <Download className="h-3 w-3 text-text-muted" />
            <span>Export Stock CSV</span>
          </a>
        </div>

        {stockMovements.length === 0 ? (
          <p className="card-base rounded-2xl p-8 text-center text-xs text-text-muted">No stock movements recorded in this period.</p>
        ) : (
          <div className="card-base overflow-hidden rounded-2xl">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm table-fixed">
                <thead>
                  <tr className="border-b border-line bg-paper/60 text-xs font-semibold uppercase tracking-wider text-ink/80">
                    <th className="py-3.5 pl-5 pr-4 min-w-[200px]">Movement Reason</th>
                    <th className="py-3.5 pr-4 text-center w-[120px]">Entries Count</th>
                    <th className="py-3.5 pr-4 text-right w-[140px]">Physical Δ</th>
                    <th className="py-3.5 pr-4 text-right w-[140px]">Reserved Δ</th>
                    <th className="py-3.5 pl-4 pr-5 text-right w-[140px]">Damaged Δ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60 text-xs">
                  {stockMovements.map((r) => (
                    <tr key={r.reason} className="transition-colors hover:bg-paper/30">
                      <td className="py-3.5 pl-5 pr-4 font-semibold text-ink align-middle">
                        {r.reason}
                      </td>
                      <td className="py-3.5 pr-4 text-center font-tabular text-text-muted align-middle">
                        {r.movements}
                      </td>
                      <td className={`py-3.5 pr-4 text-right font-tabular font-bold align-middle ${r.physical > 0 ? "text-emerald-700" : r.physical < 0 ? "text-rose-600" : "text-text-muted"}`}>
                        {signed(r.physical)}
                      </td>
                      <td className={`py-3.5 pr-4 text-right font-tabular font-bold align-middle ${r.reserved > 0 ? "text-amber-700" : r.reserved < 0 ? "text-emerald-700" : "text-text-muted"}`}>
                        {signed(r.reserved)}
                      </td>
                      <td className={`py-3.5 pl-4 pr-5 text-right font-tabular font-bold align-middle ${r.damaged > 0 ? "text-rose-600" : "text-text-muted"}`}>
                        {signed(r.damaged)}
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

function signed(n: number) {
  return n === 0 ? "—" : n > 0 ? `+${n}` : String(n);
}
