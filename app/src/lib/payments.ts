import crypto from "node:crypto";
import { OrderStatus, Prisma, PaymentMethod } from "@prisma/client";
import { transaction, type DbClient } from "@/lib/db";
import { lockRow } from "@/lib/locks";
import { recordAudit } from "@/lib/audit";
import { notify, ownerUserIds } from "@/lib/notifications";

/**
 * Automated payment verification (Paystack) layered over the existing manual
 * "mark paid" flow — both ultimately write the same Payment ledger, so "amount
 * paid" always means one thing. Same "degrades gracefully without real
 * credentials" shape as WhatsApp/email: isPaystackConfigured(), throws a
 * dedicated error on any failure, never fakes a send or a verified payment.
 *
 * Payment status rests on verified evidence only (VISION.md) — a Payment row is
 * only ever created once that evidence exists (a signed webhook, or a human
 * confirming cash/transfer actually arrived). There is deliberately no
 * "pending"/"failed" Payment: an unsuccessful attempt leaves no evidence, so
 * nothing is recorded and the order simply stays unpaid.
 */

export function isPaystackConfigured() {
  return Boolean(process.env.PAYSTACK_SECRET_KEY);
}

export class PaystackError extends Error {}
export class PaymentError extends Error {}

/**
 * Verifies Paystack's x-paystack-signature header (HMAC-SHA512 of the raw body
 * with the secret key) against the exact raw bytes Paystack sent — the same
 * "never re-serialize-then-check" rule as the WhatsApp webhook.
 */
export function verifyPaystackSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret || !signatureHeader) return false;

  const expected = crypto.createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(signatureHeader, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * The reference WE generate and hand to Paystack when starting a payment, so a
 * later webhook can be routed to the right organization and order without any
 * lookup — Payment is tenant data, so nothing can be queried before the
 * organization is known. A fresh nonce per call means a second payment link for
 * the same order (e.g. after a failed attempt) still gets a reference the unique
 * `providerReference` constraint has never seen.
 */
export function buildPaymentReference(organizationId: string, orderId: string): string {
  const nonce = crypto.randomBytes(6).toString("hex");
  return `pay_${organizationId}_${orderId}_${nonce}`;
}

/** The inverse of buildPaymentReference — strict about shape, since this string drives which tenant's data gets touched. */
export function parsePaymentReference(reference: string): { organizationId: string; orderId: string } | null {
  const match = /^pay_([a-z0-9]+)_([a-z0-9]+)_[0-9a-f]{12}$/i.exec(reference);
  if (!match) return null;
  return { organizationId: match[1], orderId: match[2] };
}

/**
 * Starts a Paystack payment for a confirmed order: generates our own reference
 * (see buildPaymentReference) and asks Paystack to open a transaction for it,
 * returning the hosted page URL to send the customer. Does not touch the
 * database — nothing is "paid" until the webhook confirms it.
 */
export async function initializePayment(params: {
  organizationId: string;
  orderId: string;
  amountCents: number;
  customerEmail: string;
}): Promise<{ authorizationUrl: string; reference: string }> {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) throw new PaystackError("Paystack isn't configured (missing PAYSTACK_SECRET_KEY).");
  if (params.amountCents <= 0) throw new PaystackError("Nothing to charge — the amount is zero.");

  const reference = buildPaymentReference(params.organizationId, params.orderId);

  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: params.customerEmail,
      amount: params.amountCents, // NGN's smallest unit (kobo) — the same integer this app already stores as "Cents".
      currency: "NGN",
      reference,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new PaystackError(`Could not start the payment (${res.status}): ${detail.slice(0, 300)}`);
  }

  const json = (await res.json()) as { status?: boolean; message?: string; data?: { authorization_url?: string } };
  if (!json.status || !json.data?.authorization_url) {
    throw new PaystackError(json.message || "Paystack did not return a payment link.");
  }

  return { authorizationUrl: json.data.authorization_url, reference };
}

/**
 * Asks Paystack to refund a previously verified transaction. Paystack's own docs are explicit
 * that a 200 here means the request was *accepted*, not that the refund has *completed* — actual
 * settlement to the customer can take Paystack up to 10 business days. The caller (returns.ts's
 * requestProviderRefund) therefore never treats this as the "refund paid" evidence itself; it
 * only records that the request was made. Does not touch our database.
 */
export async function createPaystackRefund(params: {
  transactionReference: string;
  amountCents: number;
  note?: string;
}): Promise<{ paystackStatus: string }> {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) throw new PaystackError("Paystack isn't configured (missing PAYSTACK_SECRET_KEY).");
  if (params.amountCents <= 0) throw new PaystackError("Nothing to refund — the amount is zero.");

  const res = await fetch("https://api.paystack.co/refund", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      transaction: params.transactionReference,
      amount: params.amountCents,
      merchant_note: params.note,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new PaystackError(`Could not request the refund (${res.status}): ${detail.slice(0, 300)}`);
  }

  const json = (await res.json()) as { status?: boolean; message?: string; data?: { status?: string } };
  if (!json.status) {
    throw new PaystackError(json.message || "Paystack rejected the refund request.");
  }

  return { paystackStatus: json.data?.status ?? "pending" };
}

export type PaystackWebhookEvent = {
  event: string;
  reference: string;
  amountCents: number;
  /** Paystack's own status field for this transaction, e.g. "success". */
  status: string;
  /**
   * A reusable card authorization from this charge, if there is one — the raw material for a
   * future tokenized recurring subscription (src/lib/subscriptions.ts), which Paystack requires.
   * Only ever present when Paystack marks it `reusable: true`; a one-off (e.g. bank transfer, or
   * a card the customer declined to save) never carries one.
   */
  authorizationCode: string | null;
};

/** Normalizes a Paystack webhook POST body into the fields this app acts on. */
export function parsePaystackWebhookEvent(body: unknown): PaystackWebhookEvent | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const data = b.data as Record<string, unknown> | undefined;
  if (typeof b.event !== "string" || !data) return null;

  const reference = data.reference;
  const amount = data.amount;
  const status = data.status;
  if (typeof reference !== "string" || typeof amount !== "number" || typeof status !== "string") return null;

  const authorization = data.authorization as Record<string, unknown> | undefined;
  const authorizationCode =
    authorization?.reusable === true && typeof authorization.authorization_code === "string"
      ? authorization.authorization_code
      : null;

  return { event: b.event, reference, amountCents: Math.round(amount), status, authorizationCode };
}

/** Sum of every verified payment recorded against an order — the only source of truth for "amount paid." */
export async function getPaidCents(tx: DbClient, orderId: string): Promise<number> {
  const agg = await tx.payment.aggregate({ where: { orderId }, _sum: { amountCents: true } });
  return agg._sum.amountCents ?? 0;
}

const PAYABLE_STATUSES: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PAID,
  OrderStatus.PARTIALLY_FULFILLED,
  OrderStatus.FULFILLED,
];

/**
 * Writes one Payment row against an order the caller has already locked and
 * validated, inside the caller's own transaction. Exported for orders.ts's
 * markOrderPaid, which keeps its own OrderStateError precondition checks and
 * legacy "PAYMENT_MARKED_PAID" audit label rather than this module's.
 */
export async function writePayment(
  tx: DbClient,
  order: { id: string; organizationId: string; status: OrderStatus; totalCents: number; reference: string },
  params: {
    amountCents: number;
    method: PaymentMethod;
    providerReference?: string;
    recordedById?: string;
    /** Lets a caller with its own error-type contract (markOrderPaid's OrderStateError) keep
     * the legacy audit label for "paid in full by hand" distinct from a generic ledger entry. */
    auditAction?: string;
  }
): Promise<{ payment: { id: string; amountCents: number }; paidInFullNow: boolean; totalPaidCents: number }> {
  const payment = await tx.payment.create({
    data: {
      organizationId: order.organizationId,
      orderId: order.id,
      method: params.method,
      amountCents: params.amountCents,
      providerReference: params.providerReference,
      recordedById: params.recordedById,
    },
  });

  const totalPaidCents = await getPaidCents(tx, order.id);
  const paidInFullNow = order.status === OrderStatus.CONFIRMED && totalPaidCents >= order.totalCents;

  if (paidInFullNow) {
    await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.PAID, paidAt: new Date() } });
  }

  await recordAudit(
    {
      organizationId: order.organizationId,
      entity: "Order",
      entityId: order.id,
      action: params.auditAction ?? "PAYMENT_RECORDED",
      actorId: params.recordedById,
      after: {
        method: params.method,
        amountCents: params.amountCents,
        totalPaidCents,
        orderTotalCents: order.totalCents,
        transitionedToPaid: paidInFullNow,
      },
    },
    tx
  );

  // A provider payment completes an order with no human in the loop — tell the owners
  // it happened. A manual payment doesn't need this: whoever recorded it already knows.
  if (paidInFullNow && params.method === PaymentMethod.PROVIDER) {
    const owners = await ownerUserIds(order.organizationId);
    if (owners.length > 0) {
      await notify(tx, {
        organizationId: order.organizationId,
        userIds: owners,
        kind: "PAYMENT_VERIFIED",
        title: `Payment verified for order ${order.reference}`,
        href: `/orders/${order.id}`,
        dedupeKey: `payment-verified:${payment.id}`,
      });
    }
  }

  return { payment: { id: payment.id, amountCents: payment.amountCents }, paidInFullNow, totalPaidCents };
}

/** Locks and validates the order itself, then writes the payment — the path every public function here uses. */
async function applyPayment(params: {
  organizationId: string;
  orderId: string;
  amountCents: number;
  method: PaymentMethod;
  providerReference?: string;
  recordedById?: string;
}): Promise<{ payment: { id: string; amountCents: number }; paidInFullNow: boolean; totalPaidCents: number } | null> {
  if (params.amountCents <= 0) throw new PaymentError("Payment amount must be greater than zero.");

  try {
    return await transaction(params.organizationId, async (tx) => {
      await lockRow(tx, "Order", params.orderId);
      const order = await tx.order.findFirst({ where: { id: params.orderId, organizationId: params.organizationId } });
      if (!order) throw new PaymentError("Order not found.");
      if (!PAYABLE_STATUSES.includes(order.status)) {
        throw new PaymentError(`This order is ${order.status === OrderStatus.DRAFT ? "still a draft" : "cancelled"} — nothing to pay.`);
      }

      return writePayment(tx, order, params);
    });
  } catch (err) {
    // A redelivered webhook reuses the same providerReference — the unique constraint
    // is the idempotency guard; treat it as "already processed," not an error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null;
    throw err;
  }
}

/** Records cash/bank-transfer payment a human has confirmed actually arrived. */
export async function recordManualPayment(params: {
  organizationId: string;
  orderId: string;
  amountCents: number;
  actorId: string;
}) {
  const result = await applyPayment({
    organizationId: params.organizationId,
    orderId: params.orderId,
    amountCents: params.amountCents,
    method: PaymentMethod.MANUAL,
    recordedById: params.actorId,
  });
  if (!result) throw new PaymentError("That payment was already recorded.");
  return result;
}

/**
 * Records a Paystack-verified payment. Called only after the webhook's signature
 * has been checked — this function trusts params.providerReference and
 * params.amountCents because the caller already authenticated the source.
 * Idempotent: a redelivered webhook for the same reference is a silent no-op.
 */
export async function recordProviderPayment(params: {
  organizationId: string;
  orderId: string;
  amountCents: number;
  providerReference: string;
}) {
  return applyPayment({
    organizationId: params.organizationId,
    orderId: params.orderId,
    amountCents: params.amountCents,
    method: PaymentMethod.PROVIDER,
    providerReference: params.providerReference,
  });
}
