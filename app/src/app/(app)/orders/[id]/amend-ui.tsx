"use client";


import { useSubmitAction } from "@/lib/use-submit-action";
import { amendOrderAction, type FormState } from "../actions";

const inputClass =
  "input";

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
    <form {...formProps} className="flex flex-col gap-4 card p-5">
      <p className="text-sm text-text-muted">
        Lines you change are re-priced at today&apos;s prices and the stock reservation is adjusted; lines you leave alone
        keep their agreed price. Set a quantity to 0 to remove a line.
      </p>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr className="thead-row">
              <th className="py-2 pr-4">Item</th>
              <th className="py-2 pr-4 text-right">Now</th>
              <th className="py-2">New quantity</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.orderItemId} className="trow">
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
          className="btn btn-secondary"
        >
          {pending ? "Amending…" : "Amend order"}
        </button>
      </div>
    </form>
  );
}
