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
    <form {...formProps} className="flex max-w-3xl flex-col gap-5">
      <input type="hidden" name="itemsJson" value={JSON.stringify(cart)} />
      {conversationId && <input type="hidden" name="conversationId" value={conversationId} />}

      <section className="card flex flex-col gap-4 p-5 sm:p-6">
        <h2 className="section-title flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs font-bold text-gold">1</span>
          Customer
        </h2>

        <div className="flex w-fit gap-1 rounded-xl bg-paper p-1 text-sm">
          <label
            className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 font-medium transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
              customerMode === "existing" ? "bg-surface text-ink shadow-card" : "text-text-muted hover:text-ink"
            }`}
          >
            <input
              type="radio"
              name="customerMode"
              className="sr-only"
              value="existing"
              checked={customerMode === "existing"}
              onChange={() => setCustomerMode("existing")}
            />
            Existing customer
          </label>
          <label
            className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 font-medium transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
              customerMode === "new" ? "bg-surface text-ink shadow-card" : "text-text-muted hover:text-ink"
            }`}
          >
            <input
              type="radio"
              name="customerMode"
              className="sr-only"
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
            className="input"
          >
            <option value="">Select a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? "Unnamed"} · {c.phone}
              </option>
            ))}
          </select>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="customerName" className="field-label">
                Name
              </label>
              <input
                id="customerName"
                name="customerName"
                type="text"
                className="input"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="customerPhone" className="field-label">
                Phone
              </label>
              <input
                id="customerPhone"
                name="customerPhone"
                type="text"
                required
                className="input"
              />
            </div>
          </div>
        )}
      </section>

      <section className="card flex flex-col gap-4 p-5 sm:p-6">
        <h2 className="section-title flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs font-bold text-gold">2</span>
          Items
        </h2>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
            <label htmlFor="product" className="field-label">
              Product
            </label>
            <select
              id="product"
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              className="input"
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
            <label htmlFor="quantity" className="field-label">
              Qty
            </label>
            <input
              id="quantity"
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="input"
            />
          </div>
          <button
            type="button"
            onClick={addToCart}
            className="btn btn-dark"
          >
            Add item
          </button>
        </div>
        {addError && <p className="text-sm text-status-attention-fg">{addError}</p>}

        {cart.length === 0 ? (
          <p className="empty">
            No items added yet.
          </p>
        ) : (
          <div className="card">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr className="thead-row">
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
                      <tr key={line.productId} className="trow">
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
                          {isAgreed && <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold text-accent">agreed</span>}
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
            <div className="flex items-center justify-between border-t border-line bg-paper/60 px-[1.125rem] py-3.5">
              <span className="text-sm font-semibold text-ink">Total</span>
              <span className="font-display text-2xl font-bold tracking-tight text-ink">{formatMoney(total)}</span>
            </div>
          </div>
        )}
      </section>

      <section className="card flex flex-col gap-4 p-5 sm:p-6">
        <h2 className="section-title flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs font-bold text-gold">3</span>
          Delivery &amp; notes (optional)
        </h2>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="deliveryAddress" className="field-label">
            Delivery address
          </label>
          <textarea
            id="deliveryAddress"
            name="deliveryAddress"
            rows={2}
            placeholder="Leave blank to use the customer's default address, if they have one"
            className="input"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="notes" className="field-label">
            Notes
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={2}
            className="input"
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
          className="btn btn-primary btn-lg"
        >
          {pending ? "Creating…" : "Create draft order"}
        </button>
      </div>
    </form>
  );
}
