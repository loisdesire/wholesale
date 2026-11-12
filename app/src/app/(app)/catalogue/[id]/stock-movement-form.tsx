"use client";

import { useState } from "react";
import { useSubmitAction } from "@/lib/use-submit-action";
import { recordStockMovementAction } from "../actions";

const REASON_OPTIONS = [
  { value: "PURCHASE_RECEIVED", label: "Purchase received", direction: "in" },
  { value: "RETURN", label: "Customer return", direction: "in" },
  { value: "DAMAGE", label: "Set aside as damaged", direction: "out" },
  { value: "DAMAGE_WRITTEN_OFF", label: "Write off damaged stock", direction: "out" },
  { value: "MANUAL_ADJUSTMENT", label: "Manual adjustment (count correction)", direction: "either" },
] as const;

export function StockMovementForm({ productId }: { productId: string }) {
  const { state, pending, formProps } = useSubmitAction(
    recordStockMovementAction.bind(null, productId),
    { error: null }
  , { resetOnSuccess: true });

  const [reason, setReason] = useState<string>(REASON_OPTIONS[0].value);
  const fixedDirection = REASON_OPTIONS.find((r) => r.value === reason)?.direction;

  return (
    <form {...formProps} className="flex flex-col gap-4 card p-5">
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reason" className="field-label">
            Reason
          </label>
          <select
            id="reason"
            name="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="input"
          >
            {REASON_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="direction" className="field-label">
            Direction
          </label>
          {fixedDirection === "either" ? (
            <select
              id="direction"
              name="direction"
              className="input"
            >
              <option value="in">Add to stock</option>
              <option value="out">Remove from stock</option>
            </select>
          ) : (
            <p id="direction" className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-text-muted">
              {fixedDirection === "in" ? "Adds to stock" : "Removes from stock"}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="quantity" className="field-label">
            Quantity
          </label>
          <input
            id="quantity"
            name="quantity"
            type="number"
            min="1"
            step="1"
            required
            className="input"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="note" className="field-label">
          Note (optional)
        </label>
        <input
          id="note"
          name="note"
          type="text"
          placeholder="e.g. supplier invoice #, reason for adjustment"
          className="input"
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
          className="btn btn-primary"
        >
          {pending ? "Recording…" : "Record movement"}
        </button>
      </div>
    </form>
  );
}
