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
    <form {...formProps} className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4">
      <div className="flex items-end gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="productId" className="text-sm font-medium text-ink">
            Product
          </label>
          <select
            id="productId"
            name="productId"
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
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
          <label htmlFor="quantity" className="text-sm font-medium text-ink">
            Qty
          </label>
          <input
            id="quantity"
            name="quantity"
            type="number"
            min="1"
            step="1"
            defaultValue={1}
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-line bg-paper px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-line/40 disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add item"}
        </button>
      </div>
      {state.error && <p className="text-sm text-status-attention-fg">{state.error}</p>}
    </form>
  );
}
