"use client";


import { useSubmitAction } from "@/lib/use-submit-action";
import { closeShortAction, shipItemsAction, type FormState } from "../actions";

const inputClass =
  "rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10";

export type ShipLine = { orderItemId: string; label: string; sku: string; ordered: number; shipped: number; unit: string };

/** Ship part of a paid order: enter how many of each line go in this dispatch. */
export function ShipForm({ orderId, lines }: { orderId: string; lines: ShipLine[] }) {
  const { state, pending, formProps } = useSubmitAction(shipItemsAction.bind(null, orderId), { error: null } as FormState, { resetOnSuccess: true });
  return (
    <form {...formProps} className="flex flex-col gap-4 rounded-md border border-line bg-surface p-4">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
              <th className="py-2 pr-4">Item</th>
              <th className="py-2 pr-4 text-right">Ordered</th>
              <th className="py-2 pr-4 text-right">Shipped</th>
              <th className="py-2 pr-4 text-right">Left</th>
              <th className="py-2">Ship now</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const left = l.ordered - l.shipped;
              return (
                <tr key={l.orderItemId} className="border-b border-line last:border-0">
                  <td className="py-3 pr-4 text-ink">
                    {l.label}
                    <span className="ml-2 font-tabular text-xs text-text-muted">{l.sku}</span>
                  </td>
                  <td className="py-3 pr-4 text-right font-tabular text-text-muted">{l.ordered}</td>
                  <td className="py-3 pr-4 text-right font-tabular text-text-muted">{l.shipped}</td>
                  <td className="py-3 pr-4 text-right font-tabular text-ink">{left}</td>
                  <td className="py-3">
                    <input
                      type="number"
                      name={`qty_${l.orderItemId}`}
                      min={0}
                      max={left}
                      step={1}
                      disabled={left === 0}
                      placeholder="0"
                      aria-label={`Quantity of ${l.label} to ship now`}
                      className={`${inputClass} w-24`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <input name="carrier" placeholder="Carrier (optional)" aria-label="Carrier" className={inputClass} />
        <input name="trackingReference" placeholder="Tracking reference (optional)" aria-label="Tracking reference" className={inputClass} />
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
          {pending ? "Recording…" : "Ship these items"}
        </button>
      </div>
    </form>
  );
}

/** Owner-only: stop waiting for the rest — release it and refund what never shipped. */
export function CloseShortForm({ orderId, unshippedLabel }: { orderId: string; unshippedLabel: string }) {
  const { state, pending, formProps } = useSubmitAction(closeShortAction.bind(null, orderId), { error: null } as FormState);
  return (
    <form
      {...formProps}
      onSubmit={(e) => {
        // Ask first; only then hand over to the hook's submit (which keeps the form on error).
        if (!window.confirm(`Close this order short? ${unshippedLabel} will not ship and will be refunded to the customer.`)) {
          e.preventDefault();
          return;
        }
        formProps.onSubmit(e);
      }}
      className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4"
    >
      <p className="text-sm text-text-muted">
        If the rest of the order won&apos;t ship, close it short: the unshipped stock is released and the customer is owed a
        refund for it ({unshippedLabel}).
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input name="reason" required placeholder="Why it won't ship" aria-label="Reason" className={`${inputClass} w-72`} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-line px-4 py-2 text-sm font-medium text-status-attention-fg transition-colors hover:bg-status-attention-bg disabled:opacity-60"
        >
          {pending ? "Closing…" : "Close remainder short"}
        </button>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-status-attention-fg">
          {state.error}
        </p>
      )}
    </form>
  );
}
