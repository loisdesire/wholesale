"use client";

import { useActionState, useState } from "react";
import type { Plan } from "@prisma/client";
import { getSubscriptionPaymentLinkAction, type SubscriptionLinkState } from "./actions";
import { PLAN_LIMITS } from "@/lib/billing";
import { formatMoney } from "@/lib/format";

/** Starts a Paystack payment for one period of the selected plan and shows the hosted page link. */
export function SubscriptionPaymentButton({ currentPlan }: { currentPlan: Plan }) {
  const [plan, setPlan] = useState<Plan>(currentPlan);
  const [state, formAction, pending] = useActionState<SubscriptionLinkState, FormData>(
    async () => getSubscriptionPaymentLinkAction(plan),
    { error: null }
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="plan-select" className="text-sm text-text-muted">
          Pay for
        </label>
        <select
          id="plan-select"
          value={plan}
          onChange={(e) => setPlan(e.target.value as Plan)}
          className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
        >
          {(Object.keys(PLAN_LIMITS) as Plan[]).map((p) => (
            <option key={p} value={p}>
              {PLAN_LIMITS[p].label} — {formatMoney(PLAN_LIMITS[p].monthlyFeeCents)}/mo
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-ink-2 disabled:opacity-60"
        >
          {pending ? "Starting…" : "Get payment link"}
        </button>
      </div>
      {state.error && <p className="text-sm text-status-attention-fg">{state.error}</p>}
      {state.authorizationUrl && (
        <div className="flex flex-col gap-1 rounded-md border border-line bg-surface p-3">
          <p className="text-xs text-text-muted">Pay this to activate/renew — it covers one 30-day period:</p>
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
