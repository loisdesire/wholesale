"use client";


import { useSubmitAction } from "@/lib/use-submit-action";
import { amendOrderAction, type FormState } from "../actions";

const inputClass =
  "rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10";

export type AmendLine = { orderItemId: string; label: string; sku: string; quantity: number; moq: number };

/** Change a confirmed (unpaid) order: new quantities, remove a line (0), or add a product. */
export function AmendOrderForm({
  orderId,
  lines,
  products,
}: {
  orderId: string;
  lines: AmendLine[];
  products: { id: string; label: string }[];
}) {
  const { state, pending, formProps } = useSubmitAction(amendOrderAction.bind(null, orderId), { error: null } as FormState, { resetOnSuccess: true });
  return (
    <form {...formProps} className="flex flex-col gap-4 rounded-md border border-line bg-surface p-4">
      <p className="text-sm text-text-muted">
        Lines you change are re-priced at today&apos;s prices and the stock reservation is adjusted; lines you leave alone
        keep their agreed price. Set a quantity to 0 to remove a line.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
              <th className="py-2 pr-4">Item</th>
              <th className="py-2 pr-4 text-right">Now</th>
              <th className="py-2">New quantity</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.orderItemId} className="border-b border-line last:border-0">
                <td className="py-3 pr-4 text-ink">
                  {l.label}
                  <span className="ml-2 font-tabular text-xs text-text-muted">{l.sku}</span>
                </td>
                <td className="py-3 pr-4 text-right font-tabular text-text-muted">{l.quantity}</td>
                <td className="py-3">
                  <input
                    type="number"
                    name={`qty_${l.orderItemId}`}
                    min={0}
                    step={1}
                    defaultValue={l.quantity}
                    aria-label={`New quantity of ${l.label}`}
                    className={`${inputClass} w-24`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_7rem]">
        <select name="addProductId" aria-label="Add a product" defaultValue="" className={inputClass}>
          <option value="">Add a product (optional)…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <input name="addQuantity" type="number" min={1} step={1} placeholder="Qty" aria-label="Quantity to add" className={inputClass} />
      </div>
      <input name="reason" required placeholder="Why the order is changing" aria-label="Reason for the change" className={inputClass} />
      {state.error && (
        <p role="alert" className="text-sm text-status-attention-fg">
          {state.error}
        </p>
      )}
      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-paper disabled:opacity-60"
        >
          {pending ? "Amending…" : "Amend order"}
        </button>
      </div>
    </form>
  );
}
