import { auth } from "@/lib/auth";
import { getPlatformOverview } from "@/lib/platform-admin";
import { PLAN_LIMITS } from "@/lib/billing";
import { formatDateTime } from "@/lib/format";
import { SubscriptionStatusBadge } from "@/components/status-badge";

export default async function PlatformAdminPage() {
  const session = await auth();

  if (!session!.user.isPlatformAdmin) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">This is for the platform operator only.</p>
      </div>
    );
  }

  const overview = await getPlatformOverview();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-medium text-ink">Platform admin</h1>
        <p className="mt-1 text-sm text-text-muted">
          Every organization on the platform, read-only. Nothing here edits tenant data — see an organization&apos;s own
          data by signing in as a member of it.
        </p>
      </header>

      {overview.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-text-muted">
          No organizations yet.
        </p>
      ) : (
        <div className="rounded-md border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
                  <th className="px-4 py-2">Organization</th>
                  <th className="px-4 py-2">Plan</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Trial / period ends</th>
                  <th className="px-4 py-2 text-right">Staff seats</th>
                  <th className="px-4 py-2 text-right">Orders this month</th>
                  <th className="px-4 py-2 text-right">AI replies this month</th>
                  <th className="px-4 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {overview.map((org) => (
                  <tr key={org.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 text-ink">{org.name}</td>
                    <td className="px-4 py-3 text-text-muted">{PLAN_LIMITS[org.plan].label}</td>
                    <td className="px-4 py-3">
                      <SubscriptionStatusBadge status={org.subscriptionStatus} />
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted">
                      {org.subscriptionStatus === "TRIALING" && org.trialEndsAt
                        ? formatDateTime(org.trialEndsAt)
                        : org.currentPeriodEnd
                          ? formatDateTime(org.currentPeriodEnd)
                          : "—"}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-tabular ${
                        org.staffSeats > PLAN_LIMITS[org.plan].staffSeats ? "font-medium text-status-attention-fg" : "text-ink"
                      }`}
                    >
                      {org.staffSeats} / {PLAN_LIMITS[org.plan].staffSeats}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-tabular ${
                        org.ordersThisPeriod > PLAN_LIMITS[org.plan].ordersPerMonth ? "font-medium text-status-attention-fg" : "text-ink"
                      }`}
                    >
                      {org.ordersThisPeriod} / {PLAN_LIMITS[org.plan].ordersPerMonth}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-tabular ${
                        org.aiRepliesThisPeriod > PLAN_LIMITS[org.plan].aiRepliesPerMonth ? "font-medium text-status-attention-fg" : "text-ink"
                      }`}
                    >
                      {org.aiRepliesThisPeriod} / {PLAN_LIMITS[org.plan].aiRepliesPerMonth}
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted">{formatDateTime(org.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
