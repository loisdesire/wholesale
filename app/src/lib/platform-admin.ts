import type { Plan, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getUsage, currentBillingPeriod } from "@/lib/billing";

/**
 * Read-only cross-organization overview for the platform operator (see
 * User.isPlatformAdmin) — not a tenant role, and not a bypass of tenant isolation. This never
 * reaches tenant data through anything but the normal tenantDb()-scoped path: Organization
 * itself is identity data (no RLS, same as User/Membership — see docs/ISOLATION.md), and each
 * organization's usage is fetched one organization at a time through billing.ts's own
 * getUsage(), the exact same function /billing already uses for a single organization. There is
 * no special "see everything at once" query path — scope is still enforced per call, just called
 * once per organization instead of once for the signed-in user's own.
 */
export type PlatformOrganizationOverview = {
  id: string;
  name: string;
  plan: Plan;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  createdAt: Date;
  staffSeats: number;
  ordersThisPeriod: number;
  aiRepliesThisPeriod: number;
};

export async function getPlatformOverview(): Promise<PlatformOrganizationOverview[]> {
  const organizations = await prisma.organization.findMany({ orderBy: { createdAt: "asc" } });
  const period = currentBillingPeriod();

  return Promise.all(
    organizations.map(async (org) => {
      const usage = await getUsage(org.id, period);
      return {
        id: org.id,
        name: org.name,
        plan: org.plan,
        subscriptionStatus: org.subscriptionStatus,
        trialEndsAt: org.trialEndsAt,
        currentPeriodEnd: org.currentPeriodEnd,
        createdAt: org.createdAt,
        staffSeats: usage.staffSeats,
        ordersThisPeriod: usage.ordersThisPeriod,
        aiRepliesThisPeriod: usage.aiRepliesThisPeriod,
      };
    })
  );
}
