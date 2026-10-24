import { tenantDb } from "@/lib/db";
import { PaystackError, parsePaymentReference } from "@/lib/payments";
import { parseSubscriptionPaymentReference } from "@/lib/billing";

/**
 * Compares what Paystack says it successfully charged against what this app actually recorded —
 * the natural follow-on to Phase 6's payment verification (VISION.md), for catching a webhook
 * that silently never arrived or never applied (the two webhook routes already log those
 * rejections — see docs/MONITORING_AND_BACKUPS.md — but a log line nobody is watching is not the
 * same as a report that actively surfaces the gap).
 *
 * Read-only: this never writes anything. An organization's own Payment/SubscriptionPayment rows
 * are the source of truth for what actually happened in this app; this only flags where Paystack's
 * own records disagree, for a human to look at.
 *
 * One Paystack account serves every organization on the platform today (see CLAUDE.md's billing
 * note), so Paystack's transaction list is never itself organization-scoped — every matching is
 * done by this app, by filtering to references this organization's own buildPaymentReference /
 * buildSubscriptionPaymentReference would have produced (which embed the organizationId), the same
 * way the webhook route itself decides which organization an event belongs to.
 */

export type ReconciliationDiscrepancy =
  | {
      kind: "MISSING_LOCALLY";
      reference: string;
      amountCents: number;
      paystackStatus: string;
      paidAt: string | null;
      note: string;
    }
  | {
      kind: "AMOUNT_MISMATCH";
      reference: string;
      recordedAmountCents: number;
      paystackAmountCents: number;
    };

export type ReconciliationResult = {
  sinceDays: number;
  paystackTransactionsChecked: number;
  matchingThisOrganization: number;
  discrepancies: ReconciliationDiscrepancy[];
};

type PaystackTransaction = {
  reference: string;
  amount: number;
  status: string;
  paid_at: string | null;
};

const MAX_PAGES = 20; // a sane cap — ~2000 transactions across the whole platform account per run

async function fetchRecentSuccessfulTransactions(sinceDays: number): Promise<PaystackTransaction[]> {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) throw new PaystackError("Paystack isn't configured (missing PAYSTACK_SECRET_KEY).");

  const from = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const all: PaystackTransaction[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL("https://api.paystack.co/transaction");
    url.searchParams.set("status", "success");
    url.searchParams.set("perPage", "100");
    url.searchParams.set("page", String(page));
    url.searchParams.set("from", from);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new PaystackError(`Could not list Paystack transactions (${res.status}): ${detail.slice(0, 300)}`);
    }
    const json = (await res.json()) as { status?: boolean; message?: string; data?: PaystackTransaction[] };
    if (!json.status || !json.data) throw new PaystackError(json.message || "Paystack did not return a transaction list.");

    all.push(...json.data);
    if (json.data.length < 100) break; // last page
  }

  return all;
}

/** Runs a reconciliation for one organization over the last `sinceDays` days (default 30). */
export async function reconcileProviderPayments(organizationId: string, sinceDays = 30): Promise<ReconciliationResult> {
  const transactions = await fetchRecentSuccessfulTransactions(sinceDays);

  const mine = transactions.filter((t) => {
    const asOrder = parsePaymentReference(t.reference);
    const asSubscription = parseSubscriptionPaymentReference(t.reference);
    return asOrder?.organizationId === organizationId || asSubscription?.organizationId === organizationId;
  });

  const db = tenantDb(organizationId);
  const [payments, subscriptionPayments] = await Promise.all([
    db.payment.findMany({ where: { organizationId, method: "PROVIDER" }, select: { providerReference: true, amountCents: true } }),
    db.subscriptionPayment.findMany({ where: { organizationId }, select: { providerReference: true, amountCents: true } }),
  ]);
  const recorded = new Map<string, number>();
  for (const p of payments) if (p.providerReference) recorded.set(p.providerReference, p.amountCents);
  for (const p of subscriptionPayments) if (p.providerReference) recorded.set(p.providerReference, p.amountCents);

  const discrepancies: ReconciliationDiscrepancy[] = [];
  for (const t of mine) {
    const recordedAmountCents = recorded.get(t.reference);
    if (recordedAmountCents === undefined) {
      discrepancies.push({
        kind: "MISSING_LOCALLY",
        reference: t.reference,
        amountCents: t.amount,
        paystackStatus: t.status,
        paidAt: t.paid_at,
        note: "Paystack shows this as a successful charge, but nothing was recorded for it here — the webhook may not have arrived or may have been rejected.",
      });
    } else if (recordedAmountCents !== t.amount) {
      discrepancies.push({ kind: "AMOUNT_MISMATCH", reference: t.reference, recordedAmountCents, paystackAmountCents: t.amount });
    }
  }

  return {
    sinceDays,
    paystackTransactionsChecked: transactions.length,
    matchingThisOrganization: mine.length,
    discrepancies,
  };
}
