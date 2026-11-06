"use client";

import { useSubmitAction } from "@/lib/use-submit-action";
import { closeShortAction, shipItemsAction, type FormState } from "../actions";
import { Truck, AlertTriangle, Loader2 } from "lucide-react";

const inputClass =
  "rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink";

export type ShipLine = { orderItemId: string; label: string; sku: string; ordered: number; shipped: number; unit: string };

/** Ship part of a paid order: enter how many of each line go in this dispatch. */
export function ShipForm({ orderId, lines }: { orderId: string; lines: ShipLine[] }) {
  const { state, pending, formProps } = useSubmitAction(
    shipItemsAction.bind(null, orderId), 
    { error: null } as FormState, 
    { resetOnSuccess: true }
  );

  return (
    <form {...formProps} className="card-base p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2 border-b border-line pb-3">
        <Truck className="h-4 w-4 text-ink" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink">
          Dispatch Shipment Package
        </h3>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-paper/60 text-left text-xs font-semibold uppercase tracking-wider text-ink/80">
              <th className="py-2.5 px-3">Item Description</th>
              <th className="py-2.5 px-3 text-right w-24">Ordered</th>
              <th className="py-2.5 px-3 text-right w-24">Shipped</th>
              <th className="py-2.5 px-3 text-right w-24">Remaining</th>
              <th className="py-2.5 px-3 w-32">Ship Now</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {lines.map((l) => {
              const left = l.ordered - l.shipped;
              return (
                <tr key={l.orderItemId} className="hover:bg-paper/20">
                  <td className="py-3 px-3 text-ink">
                    <div className="font-medium">{l.label}</div>
                    <span className="font-mono text-xs text-text-muted">{l.sku}</span>
                  </td>
                  <td className="py-3 px-3 text-right font-tabular text-text-muted">{l.ordered}</td>
                  <td className="py-3 px-3 text-right font-tabular text-text-muted">{l.shipped}</td>
                  <td className="py-3 px-3 text-right font-tabular font-semibold text-ink">{left}</td>
                  <td className="py-3 px-3">
                    <input
                      type="number"
                      name={`qty_${l.orderItemId}`}
                      min={0}
                      max={left}
                      step={1}
                      disabled={left === 0}
                      placeholder="0"
                      aria-label={`Quantity of ${l.label} to ship now`}
                      className={`${inputClass} w-24 font-tabular text-center`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="carrier" className="text-xs font-medium text-text-muted">
            Logistics Provider / Courier
          </label>
          <input 
            id="carrier"
            name="carrier" 
            placeholder="e.g. GIG Logistics, DHL, Driver Ibrahim" 
            aria-label="Carrier" 
            className={inputClass} 
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="trackingRef" className="text-xs font-medium text-text-muted">
            Waybill / Tracking Reference
          </label>
          <input 
            id="trackingRef"
            name="trackingRef" 
            placeholder="e.g. GIG-LOS-892301" 
            aria-label="Tracking reference" 
            className={inputClass} 
          />
        </div>
      </div>

      {state.error && (
        <div className="rounded-md border border-status-attention-fg/30 bg-status-attention-bg p-3 text-xs text-status-attention-fg">
          {state.error}
        </div>
      )}

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-paper transition-all hover:bg-accent-2 disabled:opacity-60 shadow-xs"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
          <span>{pending ? "Dispatching…" : "Confirm Shipment Dispatch"}</span>
        </button>
      </div>
    </form>
  );
}

/** Close remaining unshipped units short without fulfilling them. */
export function CloseShortForm({ orderId, unshippedLabel }: { orderId: string; unshippedLabel: string }) {
  const { state, pending, formProps } = useSubmitAction(
    closeShortAction.bind(null, orderId), 
    { error: null } as FormState
  );

  return (
    <form {...formProps} className="card-base border-status-attention-fg/20 bg-status-attention-bg/20 p-4 flex flex-col gap-3">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="h-4 w-4 text-status-attention-fg shrink-0 mt-0.5" />
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-status-attention-fg">
            Short-Close Order ({unshippedLabel})
          </h4>
          <p className="text-xs text-text-muted leading-relaxed">
            Mark this order as fulfilled without shipping the remaining {unshippedLabel}. Reserved inventory will be released back to the catalogue immediately.
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
        <input
          name="reason"
          type="text"
          required
          placeholder="Required reason for short-closing (e.g. out of stock, customer requested split cancel)"
          className={`${inputClass} flex-1 text-xs`}
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-status-attention-fg/30 bg-status-attention-bg px-4 py-2 text-xs font-semibold text-status-attention-fg transition-all hover:bg-status-attention-fg hover:text-white disabled:opacity-60 shrink-0"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          <span>{pending ? "Closing…" : "Close Remaining Short"}</span>
        </button>
      </div>

      {state.error && (
        <p className="text-xs text-status-attention-fg font-medium">{state.error}</p>
      )}
    </form>
  );
}
