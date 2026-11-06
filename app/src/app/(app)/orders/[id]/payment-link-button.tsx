"use client";

import { useActionState } from "react";
import { getPaymentLinkAction, type PaymentLinkState } from "../actions";
import { Link2, Copy, Check } from "lucide-react";
import { useState } from "react";

/** Starts a Paystack payment for the outstanding balance and shows the hosted page link to send the customer. */
export function PaymentLinkButton({ orderId }: { orderId: string }) {
  const [copied, setCopied] = useState(false);
  const [state, formAction, pending] = useActionState<PaymentLinkState, FormData>(
    async () => getPaymentLinkAction(orderId),
    { error: null }
  );

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <form action={formAction} className="inline-flex flex-col gap-2">
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-4 py-2 text-xs font-semibold text-ink transition-colors hover:bg-paper disabled:opacity-60 cursor-pointer"
      >
        <Link2 className="h-3.5 w-3.5 text-text-muted" />
        <span>{pending ? "Generating…" : "Generate Paystack Link"}</span>
      </button>
      {state.error && <p className="text-xs text-rose-600">{state.error}</p>}
      {state.authorizationUrl && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-paper/60 p-3 text-xs">
          <p className="font-semibold text-ink">Paystack Hosted Checkout:</p>
          <div className="flex items-center gap-2">
            <a
              href={state.authorizationUrl}
              target="_blank"
              rel="noreferrer"
              className="max-w-[240px] truncate font-mono text-xs text-accent underline hover:text-accent-2"
            >
              {state.authorizationUrl}
            </a>
            <button
              type="button"
              onClick={() => copyUrl(state.authorizationUrl!)}
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs font-medium text-text-muted hover:text-ink hover:bg-paper"
            >
              {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
