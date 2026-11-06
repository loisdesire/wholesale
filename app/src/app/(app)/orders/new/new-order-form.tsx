"use client";

import { useMemo, useState } from "react";
import { useSubmitAction } from "@/lib/use-submit-action";
import { createOrderAction } from "../actions";
import { formatMoney } from "@/lib/format";
import { resolveUnitPriceCents } from "@/lib/pricing";
import { 
  User, 
  Package, 
  Truck, 
  Plus, 
  Trash2, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Tag
} from "lucide-react";

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
    <form {...formProps} className="flex flex-col gap-6">
      <input type="hidden" name="itemsJson" value={JSON.stringify(cart)} />
      {conversationId && <input type="hidden" name="conversationId" value={conversationId} />}

      {/* 1. Customer Section */}
      <section className="card-base overflow-hidden">
        <div className="border-b border-line bg-paper/50 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-ink" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-ink">Customer Identity</h2>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-line bg-surface p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setCustomerMode("existing")}
              className={`rounded-md px-2.5 py-1 font-medium transition-all ${
                customerMode === "existing"
                  ? "bg-ink text-paper shadow-xs"
                  : "text-text-muted hover:text-ink"
              }`}
            >
              Existing Customer
            </button>
            <button
              type="button"
              onClick={() => setCustomerMode("new")}
              className={`rounded-md px-2.5 py-1 font-medium transition-all ${
                customerMode === "new"
                  ? "bg-ink text-paper shadow-xs"
                  : "text-text-muted hover:text-ink"
              }`}
            >
              + New Customer
            </button>
          </div>
        </div>

        <div className="p-5">
          {customerMode === "existing" ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="customerId" className="text-xs font-medium text-text-muted">
                Select Customer from Directory
              </label>
              <select
                id="customerId"
                name="customerId"
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                required
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-base sm:text-sm text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink"
              >
                <option value="">Choose customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name ?? "Unnamed Customer"} · {c.phone}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="customerName" className="text-xs font-medium text-text-muted">
                  Customer Name
                </label>
                <input
                  id="customerName"
                  name="customerName"
                  type="text"
                  placeholder="e.g. Hajia Fatima Bello"
                  className="rounded-md border border-line bg-surface px-3 py-2 text-base sm:text-sm text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="customerPhone" className="text-xs font-medium text-text-muted">
                  Phone (WhatsApp Number)
                </label>
                <input
                  id="customerPhone"
                  name="customerPhone"
                  type="text"
                  required
                  placeholder="e.g. 0803 123 4567"
                  className="rounded-md border border-line bg-surface px-3 py-2 text-base sm:text-sm text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink"
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 2. Order Line Items Cart */}
      <section className="card-base overflow-hidden">
        <div className="border-b border-line bg-paper/50 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-ink" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-ink">Order Items &amp; Pricing</h2>
          </div>
          <span className="text-xs text-text-muted font-tabular">{cart.length} item{cart.length === 1 ? "" : "s"}</span>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* Add Item Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3 bg-paper/30 p-3 rounded-lg border border-line">
            <div className="flex-1 flex flex-col gap-1.5">
              <label htmlFor="product" className="text-xs font-medium text-text-muted">
                Product SKU / Name
              </label>
              <select
                id="product"
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-base sm:text-sm text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink"
              >
                {products.map((p) => {
                  const agreed = agreedFor(p.id);
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.variantLabel ? ` (${p.variantLabel})` : ""} — {agreed ? `${formatMoney(agreed)} [Agreed]` : formatMoney(p.priceCents)}
                      {" "}· {p.stock} in stock{p.moq > 1 ? ` · MOQ ${p.moq}` : ""}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="w-full sm:w-28 flex flex-col gap-1.5">
              <label htmlFor="quantity" className="text-xs font-medium text-text-muted">
                Quantity
              </label>
              <input
                id="quantity"
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-base sm:text-sm text-ink font-tabular outline-none focus:border-ink focus:ring-1 focus:ring-ink"
              />
            </div>

            <button
              type="button"
              onClick={addToCart}
              className="inline-flex min-h-[44px] sm:min-h-[38px] items-center justify-center gap-1.5 rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition-all hover:bg-ink/90 active:scale-95 shadow-sm cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Add</span>
            </button>
          </div>

          {addError && (
            <div className="flex items-center gap-2 text-xs font-medium text-status-attention-fg bg-status-attention-bg p-2.5 rounded-md border border-status-attention-fg/20">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{addError}</span>
            </div>
          )}

          {/* Cart Section */}
          {cart.length === 0 ? (
            <div className="border border-dashed border-line rounded-lg p-8 text-center text-xs text-text-muted">
              Cart is currently empty. Select a product and quantity above to build this draft order.
            </div>
          ) : (
            <div className="rounded-lg border border-line overflow-hidden">
              {/* Mobile Cart Card List */}
              <div className="block sm:hidden divide-y divide-line">
                {cart.map((line) => {
                  const product = productMap.get(line.productId);
                  if (!product) return null;
                  const unitPrice = unitPriceFor(product, line.quantity);
                  const isAgreed = agreedFor(product.id) != null;
                  const lineSubtotal = unitPrice * line.quantity;

                  return (
                    <div key={line.productId} className="p-3.5 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-ink text-sm truncate">{product.name}</p>
                          <div className="flex items-center gap-1.5 text-xs text-text-muted mt-0.5">
                            <span className="font-mono text-xs font-bold">{product.sku}</span>
                            {product.variantLabel && <span>· {product.variantLabel}</span>}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeFromCart(line.productId)}
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-text-muted hover:text-status-attention-fg transition-colors"
                          title="Remove item"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="flex items-center justify-between text-xs pt-1 border-t border-line/50">
                        <span className="font-tabular text-text-muted">
                          {line.quantity} {product.unit}s × {formatMoney(unitPrice)}
                          {isAgreed && <span className="text-accent ml-1 font-medium">(agreed)</span>}
                        </span>
                        <span className="font-tabular font-bold text-sm text-ink">
                          {formatMoney(lineSubtotal)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Cart Table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full table-fixed border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line bg-paper/60 text-left text-xs font-semibold uppercase tracking-wider text-ink/80">
                      <th className="w-1/2 px-4 py-2.5">Item</th>
                      <th className="w-24 px-4 py-2.5 text-right">Qty</th>
                      <th className="w-32 px-4 py-2.5 text-right">Unit Price</th>
                      <th className="w-32 px-4 py-2.5 text-right">Line Total</th>
                      <th className="w-16 px-4 py-2.5 text-right" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {cart.map((line) => {
                      const product = productMap.get(line.productId);
                      if (!product) return null;
                      const unitPrice = unitPriceFor(product, line.quantity);
                      const isAgreed = agreedFor(product.id) != null;
                      const lineSubtotal = unitPrice * line.quantity;

                      return (
                        <tr key={line.productId} className="hover:bg-paper/20">
                          <td className="px-4 py-3 align-middle">
                            <div className="flex flex-col">
                              <span className="font-medium text-ink">{product.name}</span>
                              <div className="flex items-center gap-1.5 text-xs text-text-muted">
                                <span className="font-mono text-xs">{product.sku}</span>
                                {product.variantLabel && (
                                  <span>· {product.variantLabel}</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-tabular text-ink align-middle">
                            {line.quantity} <span className="text-text-muted text-xs">{product.unit}s</span>
                          </td>
                          <td className="px-4 py-3 text-right font-tabular text-ink align-middle">
                            <div>{formatMoney(unitPrice)}</div>
                            {isAgreed && (
                              <span className="inline-flex items-center gap-0.5 text-xs text-accent font-semibold">
                                <Tag className="h-3 w-3" /> contract
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-tabular font-medium text-ink align-middle">
                            {formatMoney(lineSubtotal)}
                          </td>
                          <td className="px-4 py-3 text-right align-middle">
                            <button
                              type="button"
                              onClick={() => removeFromCart(line.productId)}
                              className="rounded p-1 text-text-muted hover:text-status-attention-fg transition-colors"
                              title="Remove item"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Cart Footer */}
              <div className="flex items-center justify-between border-t border-line bg-paper/40 px-5 py-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-ink">Estimated Draft Total</span>
                <span className="font-display text-xl font-bold text-ink font-tabular">
                  {formatMoney(total)}
                </span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 3. Delivery & Fulfillment Notes */}
      <section className="card-base overflow-hidden">
        <div className="border-b border-line bg-paper/50 px-5 py-3 flex items-center gap-2">
          <Truck className="h-4 w-4 text-ink" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink">
            Delivery &amp; Fulfillment Instructions
          </h2>
        </div>

        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="deliveryAddress" className="text-xs font-medium text-text-muted">
              Delivery Address
            </label>
            <textarea
              id="deliveryAddress"
              name="deliveryAddress"
              rows={2}
              placeholder="Leave blank to use customer's verified default address"
              className="rounded-md border border-line bg-surface px-3 py-2 text-base sm:text-sm text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="notes" className="text-xs font-medium text-text-muted">
              Internal Staff Notes
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={2}
              placeholder="Packaging requirements, delivery timeline, or driver instructions"
              className="rounded-md border border-line bg-surface px-3 py-2 text-base sm:text-sm text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink"
            />
          </div>
        </div>
      </section>

      {state.error && (
        <div className="rounded-md border border-status-attention-fg/30 bg-status-attention-bg p-3 text-xs text-status-attention-fg">
          {state.error}
        </div>
      )}

      {/* Submit Footer */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-t border-line pt-4">
        <span className="text-xs text-text-muted">
          Draft orders can be amended or cancelled prior to payment confirmation.
        </span>

        <button
          type="submit"
          disabled={pending || cart.length === 0}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-accent-2 active:scale-95 disabled:opacity-60 shadow-sm cursor-pointer"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          <span>{pending ? "Creating Draft Order…" : "Create Draft Order"}</span>
        </button>
      </div>
    </form>
  );
}
