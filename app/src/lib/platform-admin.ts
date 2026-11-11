import { SubscriptionStatus, type Plan } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { transaction } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { getUsage, currentBillingPeriod } from "@/lib/billing";

/**
 * Cross-organization overview and support actions for the platform operator (see
 * User.isPlatformAdmin) — not a tenant role, and not a bypass of tenant isolation. The
 * overview never reaches tenant data through anything but the normal tenantDb()-scoped
 * path: Organization itself is identity data (no RLS, same as User/Membership — see
 * docs/ISOLATION.md), and each organization's usage is fetched one organization at a
 * time through billing.ts's own getUsage(), the exact same function /billing already
 * uses for a single organization. There is no special "see everything at once" query
 * path — scope is still enforced per call, just called once per organization instead
 * of once for the signed-in user's own.
 *
 * Support actions (extendTrial, markSubscriptionActive) are the one deliberate
 * exception to "deliberately read-only" (see docs/PROGRESS.md) — narrow, named,
 * audited actions a real support situation needs, not a general admin-edits-anything
 * surface. Everything else about an organization (plan, seats, limits) still only
 * changes through a real billing event.
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

export class PlatformAdminError extends Error {}

const MAX_EXTEND_DAYS = 90;

/**
 * The two support actions a platform admin can actually take — everything else about
 * admin stays read-only (see the module doc above). Both are deliberately narrow: no
 * free-form editing of plan, seats, or limits, which stay decided by real billing
 * events, not a support click. Each writes an AuditLog row in the *target*
 * organization's own tenant data (through transaction(), the normal tenant-scoped
 * path) so what happened is visible from inside that organization too, not just here.
 */

/**
 * Pushes a trialing organization's trial out by `days`, from whichever is later: today,
 * or its current trialEndsAt (so this always adds real runway, never silently shortens
 * a trial that still has time left by measuring from "now").
 */
export async function extendTrial(params: { organizationId: string; days: number; actorId: string }): Promise<void> {
  if (!Number.isInteger(params.days) || params.days <= 0 || params.days > MAX_EXTEND_DAYS) {
    throw new PlatformAdminError(`Enter a whole number of days between 1 and ${MAX_EXTEND_DAYS}.`);
  }

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: params.organizationId } });
  if (org.subscriptionStatus !== SubscriptionStatus.TRIALING) {
    throw new PlatformAdminError("Only a trialing organization's trial can be extended.");
  }

  const base = org.trialEndsAt && org.trialEndsAt > new Date() ? org.trialEndsAt : new Date();
  const trialEndsAt = new Date(base.getTime() + params.days * 24 * 60 * 60 * 1000);

  await prisma.organization.update({ where: { id: params.organizationId }, data: { trialEndsAt } });
  await transaction(params.organizationId, (tx) =>
    recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Organization",
        entityId: params.organizationId,
        action: "TRIAL_EXTENDED",
        actorId: params.actorId,
        before: { trialEndsAt: org.trialEndsAt?.toISOString() ?? null },
        after: { trialEndsAt: trialEndsAt.toISOString(), extendedByDays: params.days },
      },
      tx
    )
  );
}

/**
 * Manually unsticks a past-due subscription back to active — for when a payment issue
 * was actually resolved (confirmed in Paystack's own dashboard) but the renewal webhook
 * that would normally flip this never arrived or was missed. Does not touch
 * currentPeriodEnd or record a payment; it only clears the status that was blocking the
 * organization, the same way a human support action would.
 */
export async function markSubscriptionActive(params: { organizationId: string; actorId: string }): Promise<void> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: params.organizationId } });
  if (org.subscriptionStatus !== SubscriptionStatus.PAST_DUE) {
    throw new PlatformAdminError("Only a past-due subscription can be nudged back to active this way.");
  }

  await prisma.organization.update({ where: { id: params.organizationId }, data: { subscriptionStatus: SubscriptionStatus.ACTIVE } });
  await transaction(params.organizationId, (tx) =>
    recordAudit(
      {
        organizationId: params.organizationId,
        entity: "Organization",
        entityId: params.organizationId,
        action: "SUBSCRIPTION_MARKED_ACTIVE",
        actorId: params.actorId,
        before: { subscriptionStatus: org.subscriptionStatus },
        after: { subscriptionStatus: SubscriptionStatus.ACTIVE },
      },
      tx
    )
  );
}

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
