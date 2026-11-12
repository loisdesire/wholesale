import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { getEntitlementStatus, PLAN_LIMITS, isTrialExpired } from "@/lib/billing";
import { formatMoney, formatDateTime } from "@/lib/format";
import { SubscriptionStatusBadge } from "@/components/status-badge";
import { SubscriptionPaymentButton } from "./subscription-payment-button";
import { ReconciliationPanel } from "./reconciliation-panel";

export default async function BillingPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId;

  if (session!.user.role !== "OWNER") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">Billing affects the whole team, so only an owner can see it.</p>
      </div>
    );
  }

  const [org, entitlements, payments] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    getEntitlementStatus(organizationId),
    tenantDb(organizationId).subscriptionPayment.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } }),
  ]);

  const trialExpired = isTrialExpired(org);
  const limits = PLAN_LIMITS[org.plan];

  const usageRows = [
    { label: "Staff seats", used: entitlements.usage.staffSeats, limit: entitlements.limits.staffSeats, over: entitlements.overLimit.staffSeats },
    { label: "Orders this month", used: entitlements.usage.ordersThisPeriod, limit: entitlements.limits.ordersPerMonth, over: entitlements.overLimit.ordersPerMonth },
    { label: "AI replies this month", used: entitlements.usage.aiRepliesThisPeriod, limit: entitlements.limits.aiRepliesPerMonth, over: entitlements.overLimit.aiRepliesPerMonth },
  ];

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="page-title">Billing</h1>
        <p className="mt-1 text-sm text-text-muted">
          Plan, usage and subscription payment history. Plan prices and limits here are illustrative placeholders, not
          final pricing.
        </p>
      </header>

      <section className="overflow-hidden rounded-2xl bg-ink text-white shadow-pop">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-7">
          <div>
            <p className="eyebrow !text-white/55">Current plan</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <h2 className="font-display text-4xl font-bold tracking-tight">{limits.label}</h2>
              <SubscriptionStatusBadge status={org.subscriptionStatus} />
            </div>
            <p className="mt-1 text-sm text-white/65">
              <span className="font-tabular text-lg font-semibold text-gold">{formatMoney(limits.monthlyFeeCents)}</span> / month
            </p>
          </div>
          <div className="text-sm text-white/65 sm:text-right">
            {org.subscriptionStatus === "TRIALING" && org.trialEndsAt && (
              <p className={trialExpired ? "font-semibold text-[#ff8a80]" : ""}>
                {trialExpired ? "Trial ended" : "Trial ends"} {formatDateTime(org.trialEndsAt)}
              </p>
            )}
            {org.currentPeriodEnd && <p>Paid through {formatDateTime(org.currentPeriodEnd)}</p>}
          </div>
        </div>

        <div className="bg-surface p-5 text-ink sm:p-7">
          {(trialExpired || org.subscriptionStatus === "PAST_DUE") && (
            <p className="mb-4 rounded-xl border border-status-attention-fg/20 bg-status-attention-bg px-3 py-2 text-sm text-status-attention-fg">
              {trialExpired ? "Your trial has ended." : "Your subscription payment is past due."} Pay below to keep using
              everything without interruption.
            </p>
          )}
          <SubscriptionPaymentButton currentPlan={org.plan} />
        </div>
      </section>

      <section>
        <h2 className="section-title mb-3">This month&apos;s usage</h2>
        {/* Usage as meters: how full each allowance is reads faster than two columns of numbers. */}
        <div className="grid gap-3 sm:grid-cols-3">
          {usageRows.map((row) => {
            const pct = row.limit > 0 ? Math.min(100, Math.round((row.used / row.limit) * 100)) : 0;
            return (
              <div key={row.label} className="card p-5">
                <p className="eyebrow">{row.label}</p>
                <p className="mt-2 font-display text-4xl font-bold leading-none tracking-tight text-ink">
                  <span className={row.over ? "text-status-attention-fg" : ""}>{row.used}</span>
                  <span className="ml-1.5 font-sans text-sm font-medium tracking-normal text-text-muted">of {row.limit}</span>
                </p>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-paper" aria-hidden="true">
                  <div
                    className={`h-full rounded-full ${row.over ? "bg-status-attention-fg" : pct >= 80 ? "bg-[#f0a41c]" : "bg-accent"}`}
                    style={{ width: `${Math.max(pct, row.used > 0 ? 3 : 0)}%` }}
                  />
                </div>
                {row.over && <p className="mt-2 text-xs font-medium text-status-attention-fg">Over the plan limit</p>}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-text-muted">
          Going over a limit is shown here, never blocked automatically — real limits and enforcement wait until
          pricing is final.
        </p>
      </section>

      <section>
        <h2 className="section-title mb-3">Subscription payments</h2>
        {payments.length === 0 ? (
          <p className="empty">
            No subscription payments recorded yet.
          </p>
        ) : (
          <div className="card">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr className="thead-row">
                    <th className="px-4 py-2">Plan</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2">Period</th>
                    <th className="px-4 py-2">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="trow">
                      <td className="px-4 py-3 text-ink">{PLAN_LIMITS[p.plan].label}</td>
                      <td className="px-4 py-3 text-right font-tabular text-ink">{formatMoney(p.amountCents, p.currency)}</td>
                      <td className="px-4 py-3 text-xs text-text-muted">
                        {formatDateTime(p.periodStart)} – {formatDateTime(p.periodEnd)}
                      </td>
                      <td className="px-4 py-3 text-xs text-text-muted">{formatDateTime(p.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="section-title mb-1">Reconciliation</h2>
        <p className="mb-3 text-xs text-text-muted">
          Compares what Paystack says it successfully charged against what&apos;s recorded here — catches a webhook
          that silently never arrived or never applied. Read-only; nothing here changes any record.
        </p>
        <ReconciliationPanel />
      </section>

      <Link href="/" className="back-link">
        ← Back to dashboard
      </Link>
    </div>
  );
}
