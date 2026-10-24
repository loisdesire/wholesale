import { Plan } from "@prisma/client";
import { PaystackError } from "@/lib/payments";
import { PLAN_LIMITS } from "@/lib/billing";

/**
 * Plumbing for Paystack's tokenized Subscriptions API — true auto-recurring billing, as opposed
 * to the one-off-charge-per-period flow `src/lib/billing.ts` actually uses today.
 *
 * DELIBERATELY NOT WIRED UP ANYWHERE YET. Nothing in this app calls `createPaystackSubscription`
 * outside its own tests. The missing piece isn't this module — it's recognizing the renewal
 * charges Paystack would then make automatically. Paystack's Subscriptions webhook events
 * (`subscription.create`, `invoice.create`, `invoice.payment_failed`, …) and their payload shapes
 * weren't confirmable with the same confidence as the rest of this app's Paystack integration
 * (compare `/transaction/initialize`'s and `/refund`'s well-documented contracts — see
 * src/lib/payments.ts and the Phase 6 refund work in docs/PROGRESS.md). Turning this on for real
 * — letting Paystack actually start charging a saved card every period — without being able to
 * reliably apply those renewal events to the ledger would mean real money moving that this app's
 * own records silently drift out of sync with: exactly the kind of unverified-evidence state this
 * codebase's "only act on verified evidence" rule (VISION.md) exists to prevent, and arguably
 * worse than the already-deferred refund-completion webhook gap, since a refund not completing
 * automatically just means a human follows up — an unrecorded recurring charge means the owner's
 * own billing page would show a plan as past due while the customer's card is actually still
 * being charged, or the reverse.
 *
 * What IS safe to have built now: the Paystack-side Plan/Subscription creation calls themselves
 * (well-documented, standard REST calls, no webhook involved in sending them) and capturing a
 * reusable card authorization from an already-handled webhook event (see
 * parsePaystackWebhookEvent/recordSubscriptionPayment — this already happens, it's just data
 * capture, not an action). Wiring an "enable auto-renewal" button to actually call
 * createPaystackSubscription is the next step, once the renewal-webhook piece above is resolved
 * with a real Paystack account to confirm it against.
 */

function requireSecret(): string {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) throw new PaystackError("Paystack isn't configured (missing PAYSTACK_SECRET_KEY).");
  return secret;
}

function paystackPlanName(plan: Plan): string {
  return `Wholesale ${PLAN_LIMITS[plan].label}`;
}

type PaystackPlan = { plan_code: string; name: string; amount: number; interval: string };

/** Lists every plan on this Paystack account, paginated — mirrors reconciliation.ts's own paging. */
async function listPaystackPlans(secret: string): Promise<PaystackPlan[]> {
  const all: PaystackPlan[] = [];
  for (let page = 1; page <= 10; page++) {
    const url = new URL("https://api.paystack.co/plan");
    url.searchParams.set("perPage", "100");
    url.searchParams.set("page", String(page));

    const res = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new PaystackError(`Could not list Paystack plans (${res.status}): ${detail.slice(0, 300)}`);
    }
    const json = (await res.json()) as { status?: boolean; message?: string; data?: PaystackPlan[] };
    if (!json.status || !json.data) throw new PaystackError(json.message || "Paystack did not return a plan list.");

    all.push(...json.data);
    if (json.data.length < 100) break;
  }
  return all;
}

/**
 * Finds this plan tier's Paystack plan by name, creating it if this Paystack account has never
 * had one for it before. Paystack has no dedupe-by-name guarantee on its own — calling the create
 * endpoint twice for the same name makes two separate plans — so this always lists first.
 */
export async function findOrCreatePaystackPlan(plan: Plan): Promise<string> {
  const secret = requireSecret();
  const name = paystackPlanName(plan);

  const existing = (await listPaystackPlans(secret)).find((p) => p.name === name);
  if (existing) return existing.plan_code;

  const res = await fetch("https://api.paystack.co/plan", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, amount: PLAN_LIMITS[plan].monthlyFeeCents, interval: "monthly", currency: "NGN" }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new PaystackError(`Could not create the Paystack plan for ${name} (${res.status}): ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as { status?: boolean; message?: string; data?: { plan_code?: string } };
  if (!json.status || !json.data?.plan_code) throw new PaystackError(json.message || "Paystack did not return a plan code.");
  return json.data.plan_code;
}

/**
 * Creates a live, auto-recurring Paystack subscription against a previously captured reusable
 * card authorization. See this module's own doc comment — not called anywhere in the app today.
 */
export async function createPaystackSubscription(params: {
  customerEmail: string;
  planCode: string;
  authorizationCode: string;
}): Promise<{ subscriptionCode: string; status: string }> {
  const secret = requireSecret();

  const res = await fetch("https://api.paystack.co/subscription", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ customer: params.customerEmail, plan: params.planCode, authorization: params.authorizationCode }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new PaystackError(`Could not create the Paystack subscription (${res.status}): ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as { status?: boolean; message?: string; data?: { subscription_code?: string; status?: string } };
  if (!json.status || !json.data?.subscription_code) throw new PaystackError(json.message || "Paystack did not return a subscription code.");
  return { subscriptionCode: json.data.subscription_code, status: json.data.status ?? "unknown" };
}
