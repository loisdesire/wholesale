import crypto from "node:crypto";
import { Plan, Prisma, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tenantDb, transaction } from "@/lib/db";
import { PaystackError } from "@/lib/payments";

/**
 * Subscription/billing foundations (VISION.md Phase 7: "foundations for plans,
 * entitlements, usage metering, billing status, and subscription lifecycle,
 * without inventing final pricing or limits before real customer needs and costs
 * are known"). Entirely separate from src/lib/payments.ts, which is a customer
 * paying an organization for an order — "subscription payment success is never
 * confused with an individual order's payment accuracy" (VISION.md). Reuses
 * isPaystackConfigured()/verifyPaystackSignature()/PaystackError from payments.ts
 * rather than re-implementing Paystack's generic plumbing.
 *
 * PLAN_LIMITS below are illustrative placeholders, not real pricing. Entitlements
 * are informational only: going over a limit is surfaced, never silently
 * blocked — hard-enforcing invented numbers would be exactly the premature
 * commitment VISION.md warns against. Organization is identity data (no RLS,
 * read/written through the root `prisma` client, same as everywhere else in this
 * codebase); SubscriptionPayment is tenant data and goes through
 * tenantDb()/transaction() like every other tenant table.
 */

export const TRIAL_DAYS = 14;

export const PLAN_LIMITS: Record<
  Plan,
  { label: string; monthlyFeeCents: number; staffSeats: number; ordersPerMonth: number; aiRepliesPerMonth: number }
> = {
  STARTER: { label: "Starter", monthlyFeeCents: 1_500_000, staffSeats: 2, ordersPerMonth: 100, aiRepliesPerMonth: 300 },
  GROWTH: { label: "Growth", monthlyFeeCents: 3_500_000, staffSeats: 5, ordersPerMonth: 500, aiRepliesPerMonth: 1_500 },
  SCALE: { label: "Scale", monthlyFeeCents: 7_500_000, staffSeats: 20, ordersPerMonth: 2_000, aiRepliesPerMonth: 6_000 },
};

export class BillingError extends Error {}

/** Starts (or restarts) a 14-day trial on the Starter plan — call this when an organization is created. */
export async function startTrial(organizationId: string) {
  return prisma.organization.update({
    where: { id: organizationId },
    data: {
      plan: Plan.STARTER,
      subscriptionStatus: SubscriptionStatus.TRIALING,
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
      currentPeriodEnd: null,
    },
  });
}

export function isTrialExpired(org: { subscriptionStatus: SubscriptionStatus; trialEndsAt: Date | null }, now = new Date()): boolean {
  return org.subscriptionStatus === SubscriptionStatus.TRIALING && org.trialEndsAt !== null && org.trialEndsAt < now;
}

/** The calendar month `now` falls in, in UTC — the period usage is measured against. */
export function currentBillingPeriod(now = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { start, end };
}

export type Usage = { staffSeats: number; ordersThisPeriod: number; aiRepliesThisPeriod: number };

/** Usage is derived, never a separately-maintained counter — same philosophy as the stock ledger. */
export async function getUsage(organizationId: string, period: { start: Date; end: Date }): Promise<Usage> {
  const db = tenantDb(organizationId);
  const [staffSeats, ordersThisPeriod, aiRepliesThisPeriod] = await Promise.all([
    prisma.membership.count({ where: { organizationId } }),
    db.order.count({ where: { organizationId, createdAt: { gte: period.start, lte: period.end } } }),
    db.message.count({
      where: { direction: "OUTBOUND", sender: "AI", createdAt: { gte: period.start, lte: period.end }, conversation: { organizationId } },
    }),
  ]);
  return { staffSeats, ordersThisPeriod, aiRepliesThisPeriod };
}

export type EntitlementStatus = {
  plan: Plan;
  limits: (typeof PLAN_LIMITS)[Plan];
  usage: Usage;
  overLimit: { staffSeats: boolean; ordersPerMonth: boolean; aiRepliesPerMonth: boolean };
};

/** Compares this period's usage against the organization's plan — informational, see module doc. */
export async function getEntitlementStatus(organizationId: string, now = new Date()): Promise<EntitlementStatus> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { plan: true } });
  const usage = await getUsage(organizationId, currentBillingPeriod(now));
  const limits = PLAN_LIMITS[org.plan];
  return {
    plan: org.plan,
    limits,
    usage,
    overLimit: {
      staffSeats: usage.staffSeats > limits.staffSeats,
      ordersPerMonth: usage.ordersThisPeriod > limits.ordersPerMonth,
      aiRepliesPerMonth: usage.aiRepliesThisPeriod > limits.aiRepliesPerMonth,
    },
  };
}

/**
 * Same reference-embeds-identity trick as payments.ts's buildPaymentReference, with
 * its own prefix so a webhook can tell the two apart, and the plan embedded too —
 * the webhook has no other way to know which plan a given charge was paying for.
 */
export function buildSubscriptionPaymentReference(organizationId: string, plan: Plan): string {
  const nonce = crypto.randomBytes(6).toString("hex");
  return `subpay_${organizationId}_${plan.toLowerCase()}_${nonce}`;
}

export function parseSubscriptionPaymentReference(reference: string): { organizationId: string; plan: Plan } | null {
  const match = /^subpay_([a-z0-9]+)_(starter|growth|scale)_[0-9a-f]{12}$/i.exec(reference);
  if (!match) return null;
  return { organizationId: match[1], plan: match[2].toUpperCase() as Plan };
}

/**
 * Starts a Paystack payment for one period of the organization's current plan.
 * Deliberately a one-off charge per period, not Paystack's tokenized
 * auto-recurring Subscriptions API — simpler, and avoids committing to a card-on-
 * file flow before real pricing exists. Does not touch the database; nothing is
 * "paid" until the webhook confirms it.
 */
export async function initializeSubscriptionPayment(params: {
  organizationId: string;
  plan: Plan;
  ownerEmail: string;
}): Promise<{ authorizationUrl: string; reference: string }> {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) throw new PaystackError("Paystack isn't configured (missing PAYSTACK_SECRET_KEY).");

  const amountCents = PLAN_LIMITS[params.plan].monthlyFeeCents;
  const reference = buildSubscriptionPaymentReference(params.organizationId, params.plan);

  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: params.ownerEmail, amount: amountCents, currency: "NGN", reference }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new PaystackError(`Could not start the subscription payment (${res.status}): ${detail.slice(0, 300)}`);
  }

  const json = (await res.json()) as { status?: boolean; message?: string; data?: { authorization_url?: string } };
  if (!json.status || !json.data?.authorization_url) {
    throw new PaystackError(json.message || "Paystack did not return a payment link.");
  }

  return { authorizationUrl: json.data.authorization_url, reference };
}

const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Records a Paystack-verified subscription payment and marks the organization
 * active through the new period. Idempotent: a redelivered webhook for the same
 * reference is a silent no-op (the unique providerReference constraint is the
 * guard). Writing the ledger (tenant data) and updating Organization (identity
 * data) are two separate operations, not one atomic transaction — the same
 * tenant/identity boundary every other function in this codebase respects; the
 * ledger remains the source of truth if the second write is ever missed.
 */
export async function recordSubscriptionPayment(params: {
  organizationId: string;
  plan: Plan;
  amountCents: number;
  providerReference: string;
}) {
  const periodStart = new Date();
  const periodEnd = new Date(periodStart.getTime() + PERIOD_MS);

  let payment;
  try {
    payment = await transaction(params.organizationId, (tx) =>
      tx.subscriptionPayment.create({
        data: {
          organizationId: params.organizationId,
          plan: params.plan,
          amountCents: params.amountCents,
          providerReference: params.providerReference,
          periodStart,
          periodEnd,
        },
      })
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null;
    throw err;
  }

  await prisma.organization.update({
    where: { id: params.organizationId },
    data: { plan: params.plan, subscriptionStatus: SubscriptionStatus.ACTIVE, currentPeriodEnd: periodEnd },
  });

  return payment;
}
