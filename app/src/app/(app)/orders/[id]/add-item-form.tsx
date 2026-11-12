"use client";


import { useSubmitAction } from "@/lib/use-submit-action";
import { addOrderItemAction } from "../actions";
import { formatMoney } from "@/lib/format";

type ProductOption = {
  id: string;
  name: string;
  variantLabel: string | null;
  priceCents: number;
  moq: number;
  stock: number;
};

export function AddItemForm({ orderId, products }: { orderId: string; products: ProductOption[] }) {
  const { state, pending, formProps } = useSubmitAction(addOrderItemAction.bind(null, orderId), {
    error: null,
  }, { resetOnSuccess: true });

  return (
    <form {...formProps} className="flex flex-col gap-3 card p-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 basis-full flex-col gap-1.5 sm:flex-1 sm:basis-0">
          <label htmlFor="productId" className="field-label">
            Product
          </label>
          <select
            id="productId"
            name="productId"
            className="input w-full"
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.variantLabel ? ` (${p.variantLabel})` : ""} — {formatMoney(p.priceCents)} ·{" "}
                {p.stock} in stock{p.moq > 1 ? ` · MOQ ${p.moq}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="flex w-24 flex-col gap-1.5">
          <label htmlFor="quantity" className="field-label">
            Qty
          </label>
          <input
            id="quantity"
            name="quantity"
            type="number"
            min="1"
            step="1"
            defaultValue={1}
            className="input"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="btn btn-dark"
        >
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      {state.error && <p className="text-sm text-status-attention-fg">{state.error}</p>}
    </form>
  );
}
