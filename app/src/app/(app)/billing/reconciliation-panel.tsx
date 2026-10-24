"use client";

import { useActionState } from "react";
import { runReconciliationAction, type ReconciliationState } from "./actions";
import { formatMoney } from "@/lib/format";

/** Runs a read-only comparison of Paystack's own records against what this app recorded. */
export function ReconciliationPanel() {
  const [state, formAction, pending] = useActionState<ReconciliationState, FormData>(
    async () => runReconciliationAction(),
    { error: null }
  );

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-paper disabled:opacity-60"
        >
          {pending ? "Checking against Paystack…" : "Run reconciliation (last 30 days)"}
        </button>
      </form>
      {state.error && <p className="text-sm text-status-attention-fg">{state.error}</p>}
      {state.result && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">
            Checked {state.result.paystackTransactionsChecked} successful Paystack transaction
            {state.result.paystackTransactionsChecked === 1 ? "" : "s"} from the last {state.result.sinceDays} days
            across the platform, {state.result.matchingThisOrganization} of which belong to this organization.
          </p>
          {state.result.discrepancies.length === 0 ? (
            <p className="rounded-md border border-dashed border-line px-4 py-4 text-center text-sm text-text-muted">
              No discrepancies — everything Paystack says it charged matches what&apos;s recorded here.
            </p>
          ) : (
            <div className="rounded-md border border-status-attention-fg/30 bg-surface">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
                    <th className="px-4 py-2">Reference</th>
                    <th className="px-4 py-2">Issue</th>
                    <th className="px-4 py-2 text-right">Paystack</th>
                    <th className="px-4 py-2 text-right">Recorded here</th>
                  </tr>
                </thead>
                <tbody>
                  {state.result.discrepancies.map((d) => (
                    <tr key={d.reference} className="border-b border-line last:border-0">
                      <td className="px-4 py-3 font-tabular text-xs text-ink">{d.reference}</td>
                      <td className="px-4 py-3 text-xs text-text-muted">
                        {d.kind === "MISSING_LOCALLY" ? d.note : "Paystack and our own record disagree on the amount."}
                      </td>
                      <td className="px-4 py-3 text-right font-tabular text-ink">
                        {formatMoney(d.kind === "MISSING_LOCALLY" ? d.amountCents : d.paystackAmountCents)}
                      </td>
                      <td className="px-4 py-3 text-right font-tabular text-ink">
                        {d.kind === "MISSING_LOCALLY" ? "— nothing recorded" : formatMoney(d.recordedAmountCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
