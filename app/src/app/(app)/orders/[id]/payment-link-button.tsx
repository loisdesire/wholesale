"use client";

import { useActionState } from "react";
import { getPaymentLinkAction, type PaymentLinkState } from "../actions";

/** Starts a Paystack payment for the outstanding balance and shows the hosted page link to send the customer. */
export function PaymentLinkButton({ orderId }: { orderId: string }) {
  const [state, formAction, pending] = useActionState<PaymentLinkState, FormData>(
    async () => getPaymentLinkAction(orderId),
    { error: null }
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-paper disabled:opacity-60"
      >
        {pending ? "Starting…" : "Get payment link"}
      </button>
      {state.error && <p className="text-sm text-status-attention-fg">{state.error}</p>}
      {state.authorizationUrl && (
        <div className="flex flex-col gap-1 rounded-md border border-line bg-surface p-3">
          <p className="text-xs text-text-muted">Send this link to the customer — it covers the outstanding balance:</p>
          <a
            href={state.authorizationUrl}
            target="_blank"
            rel="noreferrer"
            className="break-all font-tabular text-sm text-ink underline underline-offset-2 hover:text-ink-2"
          >
            {state.authorizationUrl}
          </a>
        </div>
      )}
    </form>
  );
}
