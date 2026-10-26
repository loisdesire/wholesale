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
    <div className="flex flex-col gap-10">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Billing</h1>
        <p className="mt-1 text-sm text-text-muted">
          Plan, usage and subscription payment history. Plan prices and limits here are illustrative placeholders, not
          final pricing.
        </p>
      </header>

      <section className="rounded-md border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-medium text-ink">{limits.label} plan</h2>
              <SubscriptionStatusBadge status={org.subscriptionStatus} />
            </div>
            <p className="mt-1 text-sm text-text-muted">{formatMoney(limits.monthlyFeeCents)}/month</p>
          </div>
          <div className="text-right text-sm text-text-muted">
            {org.subscriptionStatus === "TRIALING" && org.trialEndsAt && (
              <p className={trialExpired ? "font-medium text-status-attention-fg" : ""}>
                {trialExpired ? "Trial ended" : "Trial ends"} {formatDateTime(org.trialEndsAt)}
              </p>
            )}
            {org.currentPeriodEnd && <p>Paid through {formatDateTime(org.currentPeriodEnd)}</p>}
          </div>
        </div>

        {(trialExpired || org.subscriptionStatus === "PAST_DUE") && (
          <p className="mt-3 rounded-md border border-line bg-status-attention-bg px-3 py-2 text-sm text-status-attention-fg">
            {trialExpired ? "Your trial has ended." : "Your subscription payment is past due."} Pay below to keep using
            everything without interruption.
          </p>
        )}

        <div className="mt-4">
          <SubscriptionPaymentButton currentPlan={org.plan} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink">This month&apos;s usage</h2>
        <div className="rounded-md border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
                  <th className="px-4 py-2">Metric</th>
                  <th className="px-4 py-2 text-right">Used</th>
                  <th className="px-4 py-2 text-right">Plan limit</th>
                </tr>
              </thead>
              <tbody>
                {usageRows.map((row) => (
                  <tr key={row.label} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 text-ink">{row.label}</td>
                    <td className={`px-4 py-3 text-right font-tabular ${row.over ? "font-medium text-status-attention-fg" : "text-ink"}`}>
                      {row.used}
                    </td>
                    <td className="px-4 py-3 text-right font-tabular text-text-muted">{row.limit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-2 text-xs text-text-muted">
          Going over a limit is shown here, never blocked automatically — real limits and enforcement wait until
          pricing is final.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink">Subscription payments</h2>
        {payments.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-4 py-4 text-center text-sm text-text-muted">
            No subscription payments recorded yet.
          </p>
        ) : (
          <div className="rounded-md border border-line bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
                    <th className="px-4 py-2">Plan</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2">Period</th>
                    <th className="px-4 py-2">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-b border-line last:border-0">
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
        <h2 className="mb-1 text-sm font-medium text-ink">Reconciliation</h2>
        <p className="mb-3 text-xs text-text-muted">
          Compares what Paystack says it successfully charged against what&apos;s recorded here — catches a webhook
          that silently never arrived or never applied. Read-only; nothing here changes any record.
        </p>
        <ReconciliationPanel />
      </section>

      <Link href="/" className="text-sm text-text-muted hover:text-ink">
        ← Back to dashboard
      </Link>
    </div>
  );
}
