import Link from "next/link";
import { formatMoney } from "@/lib/format";
import type { OwnerAIBriefing } from "@/lib/owner-ai";
import { ShieldAlert } from "lucide-react";

export function OwnerAIBriefingCard({ briefing }: { briefing: OwnerAIBriefing }) {
  const { metrics, criticalAlerts } = briefing;
  const hasDebt = metrics.totalReceivablesCents > 0;

  return (
    <div className="border-b border-line pb-6">
      {/* One figure does the talking; everything else is plain supporting text beside it. */}
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <p className="font-display text-4xl sm:text-5xl font-semibold tracking-tight text-ink font-tabular">
            {formatMoney(metrics.todayCashCents)}
          </p>
          <p className="mt-1 text-sm text-text-muted">Cash settled today, bank &amp; Paystack</p>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1.5 text-sm pb-1">
          <span className="text-text-muted">
            7 days <span className="font-tabular font-medium text-ink">{formatMoney(metrics.weekCashCents)}</span>
          </span>
          <span className="text-text-muted">
            Receivables{" "}
            <span className={`font-tabular font-medium ${hasDebt ? "text-status-attention-fg" : "text-ink"}`}>
              {formatMoney(metrics.totalReceivablesCents)}
            </span>
          </span>
          <Link href="/inbox" className="text-accent hover:text-accent-2 font-medium">
            {metrics.activeWhatsAppChats24h} buyer{metrics.activeWhatsAppChats24h === 1 ? "" : "s"} waiting on a reply
          </Link>
        </div>
      </div>

      {criticalAlerts.length > 0 && (
        <div className="mt-5 flex flex-col sm:flex-row sm:items-start gap-3 rounded-lg border border-status-attention-fg/25 bg-status-attention-bg px-4 py-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-status-attention-fg" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-status-attention-fg">{criticalAlerts[0].title}</p>
              <p className="text-xs text-status-attention-fg/80 mt-0.5">{criticalAlerts[0].detail}</p>
            </div>
          </div>
          <Link
            href={criticalAlerts[0].actionHref}
            className="shrink-0 text-xs font-semibold text-status-attention-fg hover:underline sm:self-center"
          >
            {criticalAlerts[0].actionLabel}
          </Link>
        </div>
      )}
    </div>
  );
}
