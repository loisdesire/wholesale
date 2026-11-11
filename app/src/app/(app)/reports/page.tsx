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
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Reports &amp; Analytics</h1>
          <p className="mt-1 text-sm text-text-muted">
            Live sales revenue, verified cash reconciliation, SKU demand, and stock movement reports for <strong className="text-ink">{formatRangeLabel(range)}</strong>.
          </p>
        </div>

        <Link
          href="/operations"
          className="inline-flex h-10 items-center gap-1.5 self-start border border-line bg-surface px-3.5 text-xs font-semibold text-ink hover:bg-paper transition-colors sm:self-auto cursor-pointer"
        >
          <span>← Back to operations desk</span>
        </Link>
      </header>

      {/* Date Range Controls & Saved Views */}
      <div className="border border-line flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form action="/reports" className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-1.5 border border-line bg-paper/40 px-3 py-1.5">
              <span className="font-medium text-text-muted">From</span>
              <input
                name="from"
                type="date"
                defaultValue={dateInput(range.from)}
                className="bg-transparent font-medium text-ink outline-none text-base sm:text-xs"
              />
            </div>
            <div className="flex items-center gap-1.5 border border-line bg-paper/40 px-3 py-1.5">
              <span className="font-medium text-text-muted">To</span>
              <input
                name="to"
                type="date"
                defaultValue={dateInput(range.to)}
                className="bg-transparent font-medium text-ink outline-none text-base sm:text-xs"
              />
            </div>
            <button
              type="submit"
              className="inline-flex h-9 items-center justify-center bg-ink px-4 font-semibold text-paper hover:bg-ink-2 transition-colors cursor-pointer"
            >
              Apply filter
            </button>
          </form>

          {/* Quick Preset Links */}
          <div className="flex items-center gap-4 text-xs font-medium">
            {[
              { label: "This month", days: 30 },
              { label: "Quarter", days: 90 },
              { label: "Year to date", days: 365 },
            ].map((p) => {
              const toDate = new Date();
              const fromDate = new Date(toDate.getTime() - p.days * 24 * 60 * 60 * 1000);
              return (
                <Link
                  key={p.label}
                  href={`/reports?from=${dateInput(fromDate)}&to=${dateInput(toDate)}`}
                  className="text-text-muted hover:text-ink transition-colors"
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
            className="inline-flex items-center gap-1.5 border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-paper transition-colors"
          >
            <Download className="h-3.5 w-3.5 text-text-muted" />
            <span>Export sales CSV</span>
          </a>
        </div>

        {/* Net cash is the one figure that matters most here; commitment and margin ride alongside it */}
        <div className="border-b border-line pb-6">
          <p className="font-display text-4xl font-semibold tracking-tight text-ink font-tabular">
            {formatMoney(sales.netCashCents)}
          </p>
          <p className="mt-1 text-sm text-text-muted">
            Net cash settled this period: <span className="text-emerald-700 font-tabular">+{formatMoney(sales.cashReceivedCents)} in</span>, <span className="text-rose-700 font-tabular">-{formatMoney(sales.refundsPaidCents)} out</span>
          </p>
          <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-1.5 text-sm">
            <span className="text-text-muted">
              Sales commitment <span className="font-tabular font-medium text-ink">{formatMoney(sales.orderValueCents)}</span> ({sales.orderCount} orders)
            </span>
            <span className="text-text-muted">
              Gross margin{" "}
              <span className="font-tabular font-medium text-ink">
                {sales.margin ? formatMoney(sales.margin.marginCents) : "not entered yet"}
              </span>
            </span>
          </div>
        </div>

        {/* Settlement Balance Breakdown */}
        <div>
          <h3 className="text-sm font-semibold text-ink mb-3">Current settlement status (open balances)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-line/70 border border-line">
            {/* Receivables Due */}
            <div className="p-4 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                  <ArrowDownLeft className="h-3.5 w-3.5 text-amber-600" />
                  <span>Unpaid receivables (owed to us)</span>
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  Value of confirmed orders that have not yet been marked paid.
                </p>
              </div>
              <span className="font-tabular text-xl font-bold text-amber-800 shrink-0 ml-4">
                {formatMoney(sales.receivablesCents)}
              </span>
            </div>

            {/* Refunds Pending Payout */}
            <div className="p-4 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                  <ArrowUpRight className="h-3.5 w-3.5 text-rose-700" />
                  <span>Pending refunds (owed by us)</span>
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  Customer returns or cancellations approved but not yet paid out.
                </p>
              </div>
              <span
                className={`font-tabular text-xl font-bold shrink-0 ml-4 ${
                  sales.refundsOwedCents > 0 ? "text-rose-700" : "text-text-muted"
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
        <div className="card-base overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="font-display text-sm font-bold text-ink">SKU volume &amp; demand</h2>
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
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs font-medium text-text-muted">
                    <th className="py-3 pl-5 pr-4 min-w-[160px]">Product</th>
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
        <div className="card-base overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="font-display text-sm font-bold text-ink">Outstanding balances (live)</h2>
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
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs font-medium text-text-muted">
                    <th className="py-3 pl-5 pr-4 min-w-[160px]">Customer</th>
                    <th className="py-3 pr-4 text-right w-[110px]">Owes us</th>
                    <th className="py-3 pr-4 text-right w-[110px]">We owe</th>
                    <th className="py-3 pr-5 text-right w-[110px]">Net position</th>
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
                      <td className={`py-3 pr-4 text-right font-tabular font-bold align-middle ${r.weOweCents > 0 ? "text-rose-700" : "text-text-muted"}`}>
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
          <h2 className="font-display text-base font-bold text-ink">Stock movement net flow</h2>
          <a
            href={`/api/reports?report=stock&${qs}`}
            className="inline-flex items-center gap-1.5 border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-paper transition-colors"
          >
            <Download className="h-3 w-3 text-text-muted" />
            <span>Export stock CSV</span>
          </a>
        </div>

        {stockMovements.length === 0 ? (
          <p className="border border-line p-8 text-center text-xs text-text-muted">No stock movements recorded in this period.</p>
        ) : (
          <div className="card-base overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs font-medium text-text-muted">
                    <th className="py-3.5 pl-5 pr-4 min-w-[200px]">Movement reason</th>
                    <th className="py-3.5 pr-4 text-center w-[120px]">Entries</th>
                    <th className="py-3.5 pr-4 text-right w-[140px]">Physical Δ</th>
                    <th className="py-3.5 pr-4 text-right w-[140px]">Reserved Δ</th>
                    <th className="py-3.5 pl-4 pr-5 text-right w-[140px]">Damaged Δ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60 text-xs">
                  {stockMovements.map((r) => (
                    <tr key={r.reason} className="transition-colors hover:bg-paper/30">
                      <td className="py-3.5 pl-5 pr-4 font-semibold text-ink align-middle">
                        {MOVEMENT_REASON_LABEL[r.reason] ?? r.reason}
                      </td>
                      <td className="py-3.5 pr-4 text-center font-tabular text-text-muted align-middle">
                        {r.movements}
                      </td>
                      <td className={`py-3.5 pr-4 text-right font-tabular font-bold align-middle ${r.physical > 0 ? "text-emerald-700" : r.physical < 0 ? "text-rose-700" : "text-text-muted"}`}>
                        {signed(r.physical)}
                      </td>
                      <td className={`py-3.5 pr-4 text-right font-tabular font-bold align-middle ${r.reserved > 0 ? "text-amber-700" : r.reserved < 0 ? "text-emerald-700" : "text-text-muted"}`}>
                        {signed(r.reserved)}
                      </td>
                      <td className={`py-3.5 pl-4 pr-5 text-right font-tabular font-bold align-middle ${r.damaged > 0 ? "text-rose-700" : "text-text-muted"}`}>
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

const MOVEMENT_REASON_LABEL: Record<string, string> = {
  INITIAL_STOCK: "Initial stock",
  PURCHASE_RECEIVED: "Purchase received",
  SALE_RESERVED: "Sale reserved",
  SALE_FULFILLED: "Sale fulfilled",
  RESERVATION_RELEASED: "Reservation released",
  RETURN: "Return",
  RETURN_DAMAGED: "Return (damaged)",
  DAMAGE: "Damage",
  DAMAGE_WRITTEN_OFF: "Damage written off",
  MANUAL_ADJUSTMENT: "Manual adjustment",
};
