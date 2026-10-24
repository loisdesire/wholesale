import { NextRequest } from "next/server";
import {
  verifyPaystackSignature,
  parsePaystackWebhookEvent,
  parsePaymentReference,
  recordProviderPayment,
  PaymentError,
} from "@/lib/payments";
import { parseSubscriptionPaymentReference, recordSubscriptionPayment, BillingError } from "@/lib/billing";

/**
 * One endpoint for every Paystack event this app cares about — a real Paystack
 * integration has a single webhook URL, not one per feature. An order payment
 * and a subscription payment both arrive as `charge.success`; which one a given
 * event is about is told apart by the reference's prefix (see
 * parsePaymentReference / parseSubscriptionPaymentReference) — the organization
 * and (for a subscription) the plan are embedded directly in that reference WE
 * generated, since nothing can be looked up before the organization is known
 * (both Payment and SubscriptionPayment are tenant data).
 */
export async function POST(req: NextRequest) {
  // Signature verification needs the exact raw bytes Paystack sent — read as
  // text before any JSON parsing, same rule as the WhatsApp webhook.
  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature");

  if (!verifyPaystackSignature(rawBody, signature)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const event = parsePaystackWebhookEvent(payload);
  if (!event) {
    // Not an event shape this app acts on — acknowledge and move on.
    return new Response("OK", { status: 200 });
  }

  if (event.event !== "charge.success" || event.status !== "success") {
    // Any other event (a failed attempt, a refund notice, …) leaves no evidence
    // of a successful payment to record — acknowledged, nothing stored.
    return new Response("OK (not a successful charge)", { status: 200 });
  }

  const subscriptionRef = parseSubscriptionPaymentReference(event.reference);
  if (subscriptionRef) {
    try {
      const result = await recordSubscriptionPayment({
        organizationId: subscriptionRef.organizationId,
        plan: subscriptionRef.plan,
        amountCents: event.amountCents,
        providerReference: event.reference,
      });
      return new Response(result ? "OK" : "OK (already processed)", { status: 200 });
    } catch (err) {
      if (err instanceof BillingError) {
        console.error(`Paystack webhook: could not apply subscription payment for org ${subscriptionRef.organizationId}: ${err.message}`);
        return new Response(`OK (${err.message})`, { status: 200 });
      }
      throw err;
    }
  }

  const parsed = parsePaymentReference(event.reference);
  if (!parsed) {
    console.error(`Paystack webhook: reference "${event.reference}" doesn't match a reference this app generated — not applied.`);
    return new Response("OK (unrecognized reference)", { status: 200 });
  }

  try {
    const result = await recordProviderPayment({
      organizationId: parsed.organizationId,
      orderId: parsed.orderId,
      amountCents: event.amountCents,
      providerReference: event.reference,
    });
    if (!result) return new Response("OK (already processed)", { status: 200 });
    return new Response("OK", { status: 200 });
  } catch (err) {
    if (err instanceof PaymentError) {
      // The order itself refused it (not found, draft, cancelled) — acknowledge so
      // Paystack doesn't retry forever; this is logged for a human to investigate,
      // since a genuine successful charge with nowhere to apply it is unusual.
      console.error(`Paystack webhook: could not apply payment for order ${parsed.orderId}: ${err.message}`);
      return new Response(`OK (${err.message})`, { status: 200 });
    }
    throw err;
  }
}
