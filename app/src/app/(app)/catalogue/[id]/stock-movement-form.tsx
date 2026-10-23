"use client";

import { useActionState } from "react";
import { recordStockMovementAction } from "../actions";

const REASON_OPTIONS = [
  { value: "PURCHASE_RECEIVED", label: "Purchase received", direction: "in" },
  { value: "RETURN", label: "Customer return", direction: "in" },
  { value: "DAMAGE", label: "Damaged / written off", direction: "out" },
  { value: "MANUAL_ADJUSTMENT", label: "Manual adjustment", direction: "either" },
] as const;

export function StockMovementForm({ productId }: { productId: string }) {
  const [state, formAction, pending] = useActionState(
    recordStockMovementAction.bind(null, productId),
    { error: null }
  );

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-md border border-line bg-surface p-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reason" className="text-sm font-medium text-ink">
            Reason
          </label>
          <select
            id="reason"
            name="reason"
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
          >
            {REASON_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="direction" className="text-sm font-medium text-ink">
            Direction
          </label>
          <select
            id="direction"
            name="direction"
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
          >
            <option value="in">Add to stock</option>
            <option value="out">Remove from stock</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="quantity" className="text-sm font-medium text-ink">
            Quantity
          </label>
          <input
            id="quantity"
            name="quantity"
            type="number"
            min="1"
            step="1"
            required
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="note" className="text-sm font-medium text-ink">
          Note (optional)
        </label>
        <input
          id="note"
          name="note"
          type="text"
          placeholder="e.g. supplier invoice #, reason for adjustment"
          className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
        />
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-status-attention-fg">
          {state.error}
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-ink-2 disabled:opacity-60"
        >
          {pending ? "Recording…" : "Record movement"}
        </button>
      </div>
    </form>
  );
}
