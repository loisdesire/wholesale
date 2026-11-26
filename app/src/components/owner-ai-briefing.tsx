import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { formatMoney } from "@/lib/format";
import type { OwnerAIBriefing } from "@/lib/owner-ai";

/** Today's money at a glance: one big figure, two supporting ones, and the one alert that matters. */
export function OwnerAIBriefingCard({ briefing }: { briefing: OwnerAIBriefing }) {
  const { metrics, criticalAlerts } = briefing;
  const hasDebt = metrics.totalReceivablesCents > 0;
  const waiting = metrics.activeWhatsAppChats24h;

  return (
    <section className="card p-4 sm:p-5">
      <p className="text-sm text-text-muted">Cash received today</p>
      <p className="font-display text-4xl font-bold leading-tight tracking-tight text-ink font-tabular sm:text-5xl">
        {formatMoney(metrics.todayCashCents)}
      </p>
      <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-text-muted">
        <span>
          7 days <span className="font-tabular font-semibold text-ink">{formatMoney(metrics.weekCashCents)}</span>
        </span>
        <span>
          Owed to you{" "}
          <span className={`font-tabular font-semibold ${hasDebt ? "text-status-attention-fg" : "text-ink"}`}>
            {formatMoney(metrics.totalReceivablesCents)}
          </span>
        </span>
        {waiting > 0 && (
          <Link href="/inbox" className="link">
            {waiting} chat{waiting === 1 ? "" : "s"} active
          </Link>
        )}
      </p>

      {criticalAlerts.length > 0 && (
        <div className="mt-4 flex flex-col gap-2 rounded-xl bg-status-attention-bg px-3.5 py-3 sm:flex-row sm:items-center sm:gap-3">
          <ShieldAlert size={16} className="hidden shrink-0 text-status-attention-fg sm:block" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-status-attention-fg">{criticalAlerts[0].title}</p>
            <p className="text-xs text-status-attention-fg">{criticalAlerts[0].detail}</p>
          </div>
          <Link href={criticalAlerts[0].actionHref} className="shrink-0 text-sm font-semibold text-status-attention-fg hover:underline">
            {criticalAlerts[0].actionLabel}
          </Link>
        </div>
      )}
    </section>
  );
}
