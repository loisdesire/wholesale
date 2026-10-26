"use client";

import { useMemo, useState } from "react";
import { useSubmitAction } from "@/lib/use-submit-action";
import { createOrderAction } from "../actions";
import { formatMoney } from "@/lib/format";
import { resolveUnitPriceCents } from "@/lib/pricing";

type Customer = { id: string; name: string | null; phone: string };
type ProductOption = {
  id: string;
  sku: string;
  name: string;
  variantLabel: string | null;
  priceCents: number;
  priceTiers: { minQuantity: number; priceCents: number }[];
  moq: number;
  unit: string;
  stock: number;
};
type CartLine = { productId: string; quantity: number };

export function NewOrderForm({
  customers,
  products,
  defaultCustomerId,
  conversationId,
  agreedPrices,
}: {
  customers: Customer[];
  products: ProductOption[];
  defaultCustomerId?: string;
  conversationId?: string;
  /** customerId -> productId -> agreed price in cents (sparse; only customers who have any). */
  agreedPrices: Record<string, Record<string, number>>;
}) {
  const { state, pending, formProps } = useSubmitAction(createOrderAction, { error: null });
  const [customerMode, setCustomerMode] = useState<"existing" | "new">(
    defaultCustomerId ? "existing" : customers.length > 0 ? "existing" : "new"
  );
  const [selectedCustomerId, setSelectedCustomerId] = useState(defaultCustomerId ?? "");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedProductId, setSelectedProductId] = useState(products[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [addError, setAddError] = useState<string | null>(null);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  // The server decides the real price; this only previews it, using the same
  // function — including any price agreed with the selected customer.
  const agreedFor = (productId: string) =>
    customerMode === "existing" ? agreedPrices[selectedCustomerId]?.[productId] : undefined;
  const unitPriceFor = (product: ProductOption, qty: number) =>
    resolveUnitPriceCents(product.priceCents, product.priceTiers, qty, agreedFor(product.id));
  const lineTotal = (product: ProductOption, qty: number) => unitPriceFor(product, qty) * qty;
  const total = cart.reduce((sum, line) => {
    const product = productMap.get(line.productId);
    return sum + (product ? lineTotal(product, line.quantity) : 0);
  }, 0);

  function addToCart() {
    setAddError(null);
    const product = productMap.get(selectedProductId);
    if (!product || quantity <= 0) return;

    const existingQty = cart.find((l) => l.productId === selectedProductId)?.quantity ?? 0;
    const newQty = existingQty + quantity;
    if (newQty < product.moq) {
      setAddError(`${product.name} has a minimum order quantity of ${product.moq} ${product.unit}s.`);
      return;
    }

    setCart((prev) => {
      const existing = prev.find((l) => l.productId === selectedProductId);
      if (existing) {
        return prev.map((l) =>
          l.productId === selectedProductId ? { ...l, quantity: l.quantity + quantity } : l
        );
      }
      return [...prev, { productId: selectedProductId, quantity }];
    });
    setQuantity(1);
  }

  function removeFromCart(productId: string) {
    setCart((prev) => prev.filter((l) => l.productId !== productId));
  }

  return (
    <form {...formProps} className="flex max-w-2xl flex-col gap-8">
      <input type="hidden" name="itemsJson" value={JSON.stringify(cart)} />
      {conversationId && <input type="hidden" name="conversationId" value={conversationId} />}

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-ink">Customer</h2>

        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="customerMode"
              value="existing"
              checked={customerMode === "existing"}
              onChange={() => setCustomerMode("existing")}
            />
            Existing customer
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="customerMode"
              value="new"
              checked={customerMode === "new"}
              onChange={() => setCustomerMode("new")}
            />
            New customer
          </label>
        </div>

        {customerMode === "existing" ? (
          <select
            name="customerId"
            value={selectedCustomerId}
            onChange={(e) => setSelectedCustomerId(e.target.value)}
            required
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
          >
            <option value="">Select a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? "Unnamed"} · {c.phone}
              </option>
            ))}
          </select>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="customerName" className="text-sm font-medium text-ink">
                Name
              </label>
              <input
                id="customerName"
                name="customerName"
                type="text"
                className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="customerPhone" className="text-sm font-medium text-ink">
                Phone
              </label>
              <input
                id="customerPhone"
                name="customerPhone"
                type="text"
                required
                className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
              />
            </div>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-ink">Items</h2>

        <div className="flex items-end gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="product" className="text-sm font-medium text-ink">
              Product
            </label>
            <select
              id="product"
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.variantLabel ? ` (${p.variantLabel})` : ""} — {formatMoney(p.priceCents)}
                  {p.priceTiers.length > 0
                    ? ` (from ${formatMoney(Math.min(...p.priceTiers.map((t) => t.priceCents)))} at ${Math.max(...p.priceTiers.map((t) => t.minQuantity))}+)`
                    : ""}{" "}
                  · {p.stock} in stock{p.moq > 1 ? ` · MOQ ${p.moq}` : ""}
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
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
            />
          </div>
          <button
            type="button"
            onClick={addToCart}
            className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-paper"
          >
            Add
          </button>
        </div>
        {addError && <p className="text-sm text-status-attention-fg">{addError}</p>}

        {cart.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-text-muted">
            No items added yet.
          </p>
        ) : (
          <div className="rounded-md border border-line bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
                    <th className="px-4 py-2">Product</th>
                    <th className="px-4 py-2 text-right">Qty</th>
                    <th className="px-4 py-2 text-right">Unit price</th>
                    <th className="px-4 py-2 text-right">Line total</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {cart.map((line) => {
                    const product = productMap.get(line.productId);
                    if (!product) return null;
                    const unitPrice = unitPriceFor(product, line.quantity);
                    const isAgreed = agreedFor(product.id) != null;
                    return (
                      <tr key={line.productId} className="border-b border-line last:border-0">
                        <td className="px-4 py-3 text-ink">
                          {product.name}
                          {product.variantLabel ? ` (${product.variantLabel})` : ""}
                        </td>
                        <td className="px-4 py-3 text-right font-tabular text-ink">
                          {line.quantity} {product.unit}
                          {line.quantity === 1 ? "" : "s"}
                        </td>
                        <td className="px-4 py-3 text-right font-tabular text-text-muted">
                          {formatMoney(unitPrice)}
                          {isAgreed && <span className="ml-1 text-xs text-text-muted">agreed</span>}
                        </td>
                        <td className="px-4 py-3 text-right font-tabular text-ink">
                          {formatMoney(unitPrice * line.quantity)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => removeFromCart(line.productId)}
                            className="text-xs text-status-attention-fg hover:underline"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-line px-4 py-3">
              <span className="text-sm font-medium text-ink">Total</span>
              <span className="font-tabular text-sm font-medium text-ink">{formatMoney(total)}</span>
            </div>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-ink">Delivery &amp; notes (optional)</h2>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="deliveryAddress" className="text-sm font-medium text-ink">
            Delivery address
          </label>
          <textarea
            id="deliveryAddress"
            name="deliveryAddress"
            rows={2}
            placeholder="Leave blank to use the customer's default address, if they have one"
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="notes" className="text-sm font-medium text-ink">
            Notes
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={2}
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
          />
        </div>
      </section>

      {state.error && (
        <p role="alert" className="text-sm text-status-attention-fg">
          {state.error}
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={pending || cart.length === 0}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-accent-2 disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create draft order"}
        </button>
      </div>
    </form>
  );
}
