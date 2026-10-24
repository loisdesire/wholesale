import { auth } from "@/lib/auth";
import { getOutstandingBalances, getProductDemand, getSalesReport, getStockMovementSummary, parseRange, toCsv } from "@/lib/reports";

/**
 * A single CSV export endpoint: `?report=sales|demand|stock|outstanding&from=&to=`.
 * All four share the same auth + range parsing, so one route keeps that in one place.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session) return new Response("Not signed in", { status: 401 });

  const url = new URL(req.url);
  const report = url.searchParams.get("report");
  const range = parseRange(url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined);
  const organizationId = session.user.organizationId;
  const stamp = new Date().toISOString().slice(0, 10);
  const naira = (cents: number) => Math.round(cents) / 100;

  let filename: string;
  let csv: string;

  if (report === "sales") {
    const s = await getSalesReport(organizationId, range);
    filename = `sales-summary-${stamp}.csv`;
    csv = toCsv(
      ["Metric", "Value"],
      [
        ["Orders confirmed in period", s.orderCount],
        ["Order value (₦)", naira(s.orderValueCents)],
        ["Average order value (₦)", s.averageOrderValueCents === null ? "" : naira(s.averageOrderValueCents)],
        ["Cash received in period (₦)", naira(s.cashReceivedCents)],
        ["Refunds paid in period (₦)", naira(s.refundsPaidCents)],
        ["Net cash in period (₦)", naira(s.netCashCents)],
        ["Receivables as of now (₦)", naira(s.receivablesCents)],
        ["Refunds owed as of now (₦)", naira(s.refundsOwedCents)],
        ["Gross margin — only lines with a recorded cost (₦)", s.margin ? naira(s.margin.marginCents) : "no cost data"],
        ["Margin coverage (% of period revenue with a cost on record)", s.margin ? `${s.margin.coveragePercent.toFixed(1)}%` : ""],
      ]
    );
  } else if (report === "demand") {
    const rows = await getProductDemand(organizationId, range, 1000);
    filename = `product-demand-${stamp}.csv`;
    csv = toCsv(
      ["SKU", "Product", "Units sold", "Revenue (₦)", "Orders"],
      rows.map((r) => [r.sku, r.name, r.units, naira(r.revenueCents), r.orders])
    );
  } else if (report === "stock") {
    const rows = await getStockMovementSummary(organizationId, range);
    filename = `stock-movements-${stamp}.csv`;
    csv = toCsv(
      ["Reason", "Movements", "Physical change", "Reserved change", "Damaged change"],
      rows.map((r) => [r.reason, r.movements, r.physical, r.reserved, r.damaged])
    );
  } else if (report === "outstanding") {
    const rows = await getOutstandingBalances(organizationId);
    filename = `outstanding-balances-${stamp}.csv`;
    csv = toCsv(
      ["Customer", "Phone", "Owes us (₦)", "We owe (₦)", "Net (₦, positive = they owe us)"],
      rows.map((r) => [r.name, r.phone, naira(r.owesUsCents), naira(r.weOweCents), naira(r.netCents)])
    );
  } else {
    return new Response("Unknown report. Use ?report=sales|demand|stock|outstanding", { status: 400 });
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
