import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { getEntitlementStatus, PLAN_LIMITS, isTrialExpired } from "@/lib/billing";
import { formatMoney, formatDateTime } from "@/lib/format";
import { SubscriptionStatusBadge } from "@/components/status-badge";
import { SubscriptionPaymentButton } from "./subscription-payment-button";
import { ReconciliationPanel } from "./reconciliation-panel";
import { AlertCircle, Lock } from "lucide-react";

export default async function BillingPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId;

  if (session!.user.role !== "OWNER") {
    return (
      <div className="border border-line flex flex-col items-center justify-center p-12 text-center">
        <Lock className="h-6 w-6 text-text-muted" />
        <h2 className="mt-3 font-display text-base font-bold text-ink">Owner access required</h2>
        <p className="mt-1 text-xs text-text-muted max-w-sm">
          Subscription plans and billing ledgers affect the entire organization. Only team owners can manage subscription renewals.
        </p>
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
    { label: "Staff Seats", used: entitlements.usage.staffSeats, limit: entitlements.limits.staffSeats, over: entitlements.overLimit.staffSeats },
    { label: "Orders Processed This Period", used: entitlements.usage.ordersThisPeriod, limit: entitlements.limits.ordersPerMonth, over: entitlements.overLimit.ordersPerMonth },
    { label: "AI Copilot Inquiries Used", used: entitlements.usage.aiRepliesThisPeriod, limit: entitlements.limits.aiRepliesPerMonth, over: entitlements.overLimit.aiRepliesPerMonth },
  ];

  return (
    <div className="flex flex-col gap-8 pb-16">
      {/* Header */}
      <header className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2.5">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Billing &amp; Subscription</h1>
          <span className="text-sm text-text-muted">{limits.label} tier</span>
        </div>
        <p className="text-sm text-text-muted">
          Platform tier management, resource consumption quotas, and verified Paystack renewal records.
        </p>
      </header>

      {/* Plan summary */}
      <div className="card-base p-6 sm:p-7">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-line/60 pb-6">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="font-display text-2xl font-bold text-ink">{limits.label} Plan</h2>
              <SubscriptionStatusBadge status={org.subscriptionStatus} />
            </div>
            <p className="mt-1 font-tabular text-2xl font-bold text-ink">
              {formatMoney(limits.monthlyFeeCents)} <span className="text-xs font-normal text-text-muted">/ month</span>
            </p>
          </div>

          <div className="text-left sm:text-right text-xs text-text-muted space-y-1">
            {org.subscriptionStatus === "TRIALING" && org.trialEndsAt && (
              <p className={trialExpired ? "font-bold text-rose-700" : "font-semibold text-ink"}>
                {trialExpired ? "Trial concluded on" : "Complimentary trial active until"}{" "}
                <span className="font-tabular">{formatDateTime(org.trialEndsAt)}</span>
              </p>
            )}
            {org.currentPeriodEnd && (
              <p className="font-medium text-ink">
                Paid billing cycle valid through <span className="font-tabular font-bold">{formatDateTime(org.currentPeriodEnd)}</span>
              </p>
            )}
          </div>
        </div>

        {/* Warning Banner if expired / past due */}
        {(trialExpired || org.subscriptionStatus === "PAST_DUE") && (
          <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-rose-200 bg-rose-50/70 p-3.5 text-xs text-rose-900">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-700" />
            <span>
              {trialExpired ? "Your complimentary trial period has concluded." : "Your monthly platform subscription payment is currently past due."} Renew via Paystack to maintain seamless WhatsApp integration.
            </span>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <SubscriptionPaymentButton currentPlan={org.plan} />
        </div>
      </div>

      {/* 2-Column Responsive Layout: Usage Quotas & Payment History */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Resource Quotas & Usage */}
        <div className="card-base overflow-hidden">
          <div className="border-b border-line px-5 py-3.5">
            <h2 className="font-display text-sm font-bold text-ink">Monthly quota consumption</h2>
            <p className="text-xs text-text-muted">Current period entitlement utilization.</p>
          </div>

          <div className="p-5 space-y-5">
            {usageRows.map((row) => {
              const percent = Math.min(100, Math.round((row.used / row.limit) * 100));
              return (
                <div key={row.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-ink">{row.label}</span>
                    <span className="font-tabular font-medium text-ink">
                      <strong className={row.over ? "text-rose-700 font-bold" : "text-ink"}>{row.used}</strong> / {row.limit}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-paper">
                    <div
                      className={`h-full rounded-full transition-all ${
                        row.over
                          ? "bg-rose-500"
                          : percent > 80
                            ? "bg-amber-500"
                            : "bg-accent"
                      }`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Subscription Payment Receipts */}
        <div className="card-base overflow-hidden">
          <div className="border-b border-line px-5 py-3.5">
            <h2 className="font-display text-sm font-bold text-ink">Paystack subscription receipts</h2>
            <p className="text-xs text-text-muted">Verified platform payment transactions.</p>
          </div>

          {payments.length === 0 ? (
            <div className="p-8 text-center text-xs text-text-muted">
              No subscription receipts recorded yet.
            </div>
          ) : (
            <div className="divide-y divide-line/60">
              {payments.map((p) => (
                <div key={p.id} className="p-4 flex items-center justify-between text-xs hover:bg-paper/20 transition-colors">
                  <div>
                    <p className="font-mono font-bold text-ink">{p.providerReference ?? p.id}</p>
                    <p className="font-tabular text-xs text-text-muted">{formatDateTime(p.createdAt)}</p>
                  </div>
                  <span className="font-tabular font-bold text-ink">
                    {formatMoney(p.amountCents, p.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Paystack Payment Reconciliation Ledger */}
      <ReconciliationPanel />
    </div>
  );
}
