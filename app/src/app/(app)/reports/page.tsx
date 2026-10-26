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

  const [sales, demand, stockMovements, outstanding] = await Promise.all([
    getSalesReport(organizationId, range),
    getProductDemand(organizationId, range),
    getStockMovementSummary(organizationId, range),
    getOutstandingBalances(organizationId),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Reports</h1>
          <p className="mt-1 text-sm text-text-muted">
            Everything below is computed from real records for {formatRangeLabel(range)}. Revenue, cash, receivables and
            refunds are kept separate — none of this is labelled profit unless a cost is on record.
          </p>
        </div>
        <Link href="/operations" className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-paper">
          ← Operations
        </Link>
      </header>

      <form action="/reports" className="flex items-end gap-2">
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

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink">Sales summary</h2>
          <a href={`/api/reports?report=sales&${qs}`} className="text-xs text-ink underline underline-offset-2">
            Download CSV
          </a>
        </div>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line md:grid-cols-4">
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
          ].map((f) => (
            <div key={f.label} className="bg-surface p-4">
              <dt className="text-xs text-text-muted">{f.label}</dt>
              <dd className={`mt-1 font-tabular text-lg font-medium ${f.attention ? "text-status-attention-fg" : "text-ink"}`}>{f.value}</dd>
              <p className="mt-1 text-xs text-text-muted">{f.hint}</p>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink">Product demand</h2>
          <a href={`/api/reports?report=demand&${qs}`} className="text-xs text-ink underline underline-offset-2">
            Download CSV
          </a>
        </div>
        {demand.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-text-muted">
            No confirmed orders in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
                  <th className="py-2 pr-4">Product</th>
                  <th className="py-2 pr-4 text-right">Units sold</th>
                  <th className="py-2 pr-4 text-right">Revenue</th>
                  <th className="py-2 pr-4 text-right">Orders</th>
                </tr>
              </thead>
              <tbody>
                {demand.map((d) => (
                  <tr key={d.productId} className="border-b border-line last:border-0">
                    <td className="py-3 pr-4 text-ink">
                      <Link href={`/catalogue/${d.productId}`} className="underline-offset-2 hover:underline">
                        {d.name}
                      </Link>
                      <span className="ml-2 font-tabular text-xs text-text-muted">{d.sku}</span>
                    </td>
                    <td className="py-3 pr-4 text-right font-tabular text-ink">{d.units}</td>
                    <td className="py-3 pr-4 text-right font-tabular text-ink">{formatMoney(d.revenueCents)}</td>
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
          <h2 className="text-sm font-medium text-ink">Stock movement</h2>
          <a href={`/api/reports?report=stock&${qs}`} className="text-xs text-ink underline underline-offset-2">
            Download CSV
          </a>
        </div>
        {stockMovements.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-text-muted">
            No stock movements in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
                  <th className="py-2 pr-4">Reason</th>
                  <th className="py-2 pr-4 text-right">Movements</th>
                  <th className="py-2 pr-4 text-right">Physical change</th>
                  <th className="py-2 pr-4 text-right">Reserved change</th>
                  <th className="py-2 pr-4 text-right">Damaged change</th>
                </tr>
              </thead>
              <tbody>
                {stockMovements.map((r) => (
                  <tr key={r.reason} className="border-b border-line last:border-0">
                    <td className="py-3 pr-4 text-ink">{r.reason}</td>
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
          <h2 className="text-sm font-medium text-ink">Outstanding balances (now)</h2>
          <a href={`/api/reports?report=outstanding`} className="text-xs text-ink underline underline-offset-2">
            Download CSV
          </a>
        </div>
        {outstanding.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-text-muted">
            Everyone is settled — nobody owes, and nothing is owed.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
                  <th className="py-2 pr-4">Customer</th>
                  <th className="py-2 pr-4 text-right">Owes us</th>
                  <th className="py-2 pr-4 text-right">We owe</th>
                  <th className="py-2 pr-4 text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {outstanding.map((r) => (
                  <tr key={r.customerId} className="border-b border-line last:border-0">
                    <td className="py-3 pr-4 text-ink">
                      <Link href={`/customers/${r.customerId}`} className="underline-offset-2 hover:underline">
                        {r.name}
                      </Link>
                      <span className="ml-2 font-tabular text-xs text-text-muted">{r.phone}</span>
                    </td>
                    <td className="py-3 pr-4 text-right font-tabular text-ink">{formatMoney(r.owesUsCents)}</td>
                    <td className={`py-3 pr-4 text-right font-tabular ${r.weOweCents > 0 ? "text-status-attention-fg" : "text-ink"}`}>
                      {formatMoney(r.weOweCents)}
                    </td>
                    <td className="py-3 pr-4 text-right font-tabular text-ink">{formatMoney(r.netCents)}</td>
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
