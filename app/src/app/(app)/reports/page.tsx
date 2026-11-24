import Link from "next/link";
import { Download } from "lucide-react";
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
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="page-title">Reports</h1>
        <p className="mt-0.5 text-sm text-text-muted">{formatRangeLabel(range)}</p>
      </header>

      <form action="/reports" className="flex flex-wrap items-end gap-2">
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

      <SavedViews views={savedViews} from={dateInput(range.from)} to={dateInput(range.to)} rangeLabel={formatRangeLabel(range)} />

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">Sales summary</h2>
          <a href={`/api/reports?report=sales&${qs}`} className="btn btn-secondary btn-sm">
            <Download size={13} />
            CSV
          </a>
        </div>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: "Order value", value: formatMoney(sales.orderValueCents), hint: `${sales.orderCount} order${sales.orderCount === 1 ? "" : "s"} confirmed` },
            { label: "Average order value", value: sales.averageOrderValueCents === null ? "—" : formatMoney(sales.averageOrderValueCents), hint: "Per confirmed order" },
            { label: "Cash received", value: formatMoney(sales.cashReceivedCents), hint: "Orders marked paid in period" },
            { label: "Refunds paid", value: formatMoney(sales.refundsPaidCents), hint: "Paid out in period" },
            { label: "Net cash", value: formatMoney(sales.netCashCents), hint: "Cash received less refunds paid" },
            { label: "Receivables (now)", value: formatMoney(sales.receivablesCents), hint: "Confirmed, not yet paid" },
            { label: "Refunds owed (now)", value: formatMoney(sales.refundsOwedCents), hint: "Approved, not yet paid out", attention: sales.refundsOwedCents > 0 },
            {
              label: "Gross margin",
              value: sales.margin ? formatMoney(sales.margin.marginCents) : "—",
              hint: sales.margin
                ? `Covers ${sales.margin.coveragePercent.toFixed(0)}% of period revenue (${sales.margin.linesWithCost} of ${sales.margin.lines} line${sales.margin.lines === 1 ? "" : "s"} have a cost on record)`
                : "No product sold in this period has a cost recorded",
            },
          ].map((f, i) => (
            // The first figure (order value) is the headline, so it alone gets the dark tile.
            <div key={f.label} className={i === 0 ? "rounded-2xl bg-ink p-4 text-white shadow-card sm:p-5" : "card p-4 sm:p-5"}>
              <dt className={`text-xs font-medium ${i === 0 ? "text-white/70" : "text-text-muted"}`}>{f.label}</dt>
              <dd
                className={`mt-1.5 break-words font-display text-xl font-bold leading-tight tracking-tight sm:text-3xl ${
                  i === 0 ? "text-gold" : f.attention ? "text-status-attention-fg" : "text-ink"
                }`}
              >
                {f.value}
              </dd>
              <p className={`mt-1.5 hidden text-xs leading-relaxed sm:block ${i === 0 ? "text-white/70" : "text-text-muted"}`}>{f.hint}</p>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">Product demand</h2>
          <a href={`/api/reports?report=demand&${qs}`} className="btn btn-secondary btn-sm">
            <Download size={13} />
            CSV
          </a>
        </div>
        {demand.length === 0 ? (
          <p className="empty">
            No confirmed orders in this period.
          </p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr className="thead-row">
                  <th className="py-2 pr-4">Product</th>
                  <th className="py-2 pr-4 text-right">Units sold</th>
                  <th className="py-2 pr-4 text-right">Revenue</th>
                  <th className="py-2 pr-4 text-right">Orders</th>
                </tr>
              </thead>
              <tbody>
                {demand.map((d) => (
                  <tr key={d.productId} className="trow">
                    <td className="whitespace-nowrap py-3 pr-4 text-ink">
                      <Link href={`/catalogue/${d.productId}`} className="underline-offset-2 hover:underline">
                        {d.name}
                      </Link>
                      <span className="ml-2 hidden font-mono text-xs text-text-muted sm:inline">{d.sku}</span>
                    </td>
                    <td className="py-3 pr-4 text-right font-tabular text-ink">{d.units}</td>
                    <td className="py-3 pr-4 text-right font-tabular font-semibold text-ink">
                      <div className="flex items-center justify-end gap-3">
                        {/* Share of the best seller's revenue, so the ranking reads at a glance. */}
                        <span className="hidden h-2 w-28 overflow-hidden rounded-full bg-paper sm:block" aria-hidden="true">
                          <span
                            className="block h-full rounded-full bg-accent"
                            style={{ width: `${Math.max(3, (d.revenueCents / Math.max(1, ...demand.map((x) => x.revenueCents))) * 100)}%` }}
                          />
                        </span>
                        <span className="w-24">{formatMoney(d.revenueCents)}</span>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-right font-tabular text-text-muted">{d.orders}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">Stock movement</h2>
          <a href={`/api/reports?report=stock&${qs}`} className="btn btn-secondary btn-sm">
            <Download size={13} />
            CSV
          </a>
        </div>
        {stockMovements.length === 0 ? (
          <p className="empty">
            No stock movements in this period.
          </p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr className="thead-row">
                  <th className="py-2 pr-4">Reason</th>
                  <th className="py-2 pr-4 text-right">Movements</th>
                  <th className="py-2 pr-4 text-right">Physical change</th>
                  <th className="py-2 pr-4 text-right">Reserved change</th>
                  <th className="py-2 pr-4 text-right">Damaged change</th>
                </tr>
              </thead>
              <tbody>
                {stockMovements.map((r) => (
                  <tr key={r.reason} className="trow">
                    <td className="py-3 pr-4 font-medium text-ink">{r.reason}</td>
                    <td className="py-3 pr-4 text-right font-tabular text-text-muted">{r.movements}</td>
                    <td className="py-3 pr-4 text-right font-tabular text-ink">{signed(r.physical)}</td>
                    <td className="py-3 pr-4 text-right font-tabular text-ink">{signed(r.reserved)}</td>
                    <td className="py-3 pr-4 text-right font-tabular text-ink">{signed(r.damaged)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">Outstanding balances (now)</h2>
          <a href={`/api/reports?report=outstanding`} className="btn btn-secondary btn-sm">
            <Download size={13} />
            CSV
          </a>
        </div>
        {outstanding.length === 0 ? (
          <p className="empty">
            Everyone is settled — nobody owes, and nothing is owed.
          </p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr className="thead-row">
                  <th className="py-2 pr-4">Customer</th>
                  <th className="py-2 pr-4 text-right">Owes us</th>
                  <th className="py-2 pr-4 text-right">We owe</th>
                  <th className="py-2 pr-4 text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {outstanding.map((r) => (
                  <tr key={r.customerId} className="trow">
                    <td className="py-3 pr-4 text-ink">
                      <Link href={`/customers/${r.customerId}`} className="underline-offset-2 hover:underline">
                        {r.name}
                      </Link>
                      <span className="ml-2 hidden font-tabular text-xs text-text-muted sm:inline">{r.phone}</span>
                    </td>
                    <td className="py-3 pr-4 text-right font-tabular text-ink">{formatMoney(r.owesUsCents)}</td>
                    <td className={`py-3 pr-4 text-right font-tabular ${r.weOweCents > 0 ? "text-status-attention-fg" : "text-ink"}`}>
                      {formatMoney(r.weOweCents)}
                    </td>
                    <td className="py-3 pr-4 text-right font-tabular font-semibold text-ink">{formatMoney(r.netCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function signed(n: number) {
  return n === 0 ? "—" : n > 0 ? `+${n}` : String(n);
}
