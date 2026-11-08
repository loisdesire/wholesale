import Link from "next/link";
import { formatMoney } from "@/lib/format";
import type { OwnerAIBriefing } from "@/lib/owner-ai";
import { ArrowRight, ShieldAlert, ArrowUpRight } from "lucide-react";

export function OwnerAIBriefingCard({ briefing }: { briefing: OwnerAIBriefing }) {
  const { metrics, criticalAlerts } = briefing;

  return (
    <div className="space-y-4">
      {/* 4 Stat Cards: Crisp, high-contrast, structured like TaskGo & Flowpay */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Card 1: 24h Cash Inflow */}
        <div className="card-base p-4 sm:p-5 rounded-2xl border border-line shadow-xs flex flex-col justify-between hover:border-accent/30 transition-colors">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text-muted">Cash Settled (24h)</span>
              <span className="rounded-md bg-paper border border-line px-1.5 py-0.5 font-mono text-[11px] font-bold text-ink/75">
                24 Hours
              </span>
            </div>
            <p className="font-display text-2xl sm:text-3xl font-bold font-tabular text-ink mt-2">
              {formatMoney(metrics.todayCashCents)}
            </p>
          </div>
          <div className="mt-3 pt-2.5 border-t border-line/60 flex items-center justify-between text-xs text-text-muted">
            <span>Verified settlements</span>
            <span className="font-medium text-ink/75">Bank &amp; Paystack</span>
          </div>
        </div>

        {/* Card 2: 7-Day Verified Revenue */}
        <div className="card-base p-4 sm:p-5 rounded-2xl border border-line shadow-xs flex flex-col justify-between hover:border-accent/30 transition-colors">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text-muted">7-Day Verified Revenue</span>
              <span className="rounded-md bg-paper border border-line px-1.5 py-0.5 font-mono text-[11px] font-bold text-ink/75">
                7 Days
              </span>
            </div>
            <p className="font-display text-2xl sm:text-3xl font-bold font-tabular text-ink mt-2">
              {formatMoney(metrics.weekCashCents)}
            </p>
          </div>
          <div className="mt-3 pt-2.5 border-t border-line/60 flex items-center justify-between text-xs text-text-muted">
            <span>Settled bank receipts</span>
            <span className="font-medium text-ink/75">Bank &amp; Paystack</span>
          </div>
        </div>

        {/* Card 3: Open Receivables / Customer Credit */}
        <div className="card-base p-4 sm:p-5 rounded-2xl border border-line shadow-xs flex flex-col justify-between hover:border-accent/30 transition-colors">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text-muted">Open Receivables</span>
              {metrics.totalReceivablesCents > 0 && (
                <Link
                  href="/reports"
                  className="text-xs font-semibold text-accent hover:text-accent-2 inline-flex items-center gap-0.5"
                >
                  <span>Ledger</span>
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              )}
            </div>
            <p className="font-display text-2xl sm:text-3xl font-bold font-tabular text-ink mt-2">
              {formatMoney(metrics.totalReceivablesCents)}
            </p>
          </div>
          <div className="mt-3 pt-2.5 border-t border-line/60 flex items-center justify-between text-xs text-text-muted">
            <span>Customer credit balance</span>
            <span className={metrics.totalReceivablesCents > 0 ? "font-bold text-rose-700" : "font-medium text-ink/70"}>
              {metrics.totalReceivablesCents > 0 ? "Requires collection" : "Zero debt"}
            </span>
          </div>
        </div>

        {/* Card 4: WhatsApp Buyer Volume */}
        <div className="card-base p-4 sm:p-5 rounded-2xl border border-line shadow-xs flex flex-col justify-between hover:border-accent/30 transition-colors">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text-muted">Buyer Inquiries (24h)</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
                <span>Live</span>
              </span>
            </div>
            <div className="flex items-baseline gap-2 mt-2">
              <p className="font-display text-2xl sm:text-3xl font-bold font-tabular text-ink">
                {metrics.activeWhatsAppChats24h}
              </p>
              <span className="text-xs text-text-muted font-medium">conversations</span>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-line/60 flex items-center justify-between text-xs text-text-muted">
            <span>Inbound buyer chats</span>
            <Link href="/inbox" className="font-semibold text-accent hover:underline">
              Open inbox →
            </Link>
          </div>
        </div>
      </div>

      {/* Critical Operational Alerts Ribbon */}
      {criticalAlerts.length > 0 && (
        <div className="rounded-2xl border border-amber-300/80 bg-amber-50/90 p-4 sm:p-4.5 text-xs text-amber-950 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-800">
              <ShieldAlert className="h-4.5 w-4.5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <strong className="font-display text-sm font-bold text-amber-950">
                  {criticalAlerts[0].title}
                </strong>
                <span className="rounded-md bg-amber-200/80 px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wide text-amber-900">
                  {criticalAlerts[0].type}
                </span>
              </div>
              <p className="text-amber-900/90 mt-0.5 text-xs leading-relaxed max-w-2xl">
                {criticalAlerts[0].detail}
              </p>
            </div>
          </div>

          <Link
            href={criticalAlerts[0].actionHref}
            className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-xl bg-amber-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-950 transition-all cursor-pointer shadow-xs shrink-0"
          >
            <span>{criticalAlerts[0].actionLabel}</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}
