"use client";

import { useSubmitAction } from "@/lib/use-submit-action";
import { addAddressAction, setPriceAction, updateCustomerAction, type FormState } from "../actions";
import { Save, Plus, Loader2, Check, AlertCircle, MapPin, Tag } from "lucide-react";

const inputClass =
  "rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink";

function Feedback({ error, done }: { error: string | null; done: boolean }) {
  if (error) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-status-attention-fg font-medium">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }
  return done ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-status-success-fg">
      <Check className="h-3.5 w-3.5" /> Saved
    </span>
  ) : null;
}

export function EditCustomerForm({
  customerId,
  name,
  email,
  notes,
}: {
  customerId: string;
  name: string | null;
  email: string | null;
  notes: string | null;
}) {
  const { state, pending, formProps } = useSubmitAction(
    updateCustomerAction.bind(null, customerId), 
    { error: null } as FormState
  );

  return (
    <form {...formProps} className="card-base p-5 flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="text-xs font-semibold text-ink">
            Customer / Business Name
          </label>
          <input id="name" name="name" defaultValue={name ?? ""} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-xs font-semibold text-ink">
            Email Address
          </label>
          <input id="email" name="email" type="email" defaultValue={email ?? ""} className={inputClass} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className="text-xs font-semibold text-ink">
          Operational Notes &amp; Habits
        </label>
        <textarea id="notes" name="notes" rows={3} defaultValue={notes ?? ""} className={inputClass} />
      </div>

      <div className="flex items-center justify-between border-t border-line pt-3">
        <Feedback error={state.error} done={Boolean(state.saved) && !pending} />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-xs font-semibold text-paper transition-all hover:bg-accent-2 disabled:opacity-60 shadow-xs ml-auto"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          <span>{pending ? "Saving…" : "Save Details"}</span>
        </button>
      </div>
    </form>
  );
}

export function AddAddressForm({ customerId }: { customerId: string }) {
  const { state, pending, formProps } = useSubmitAction(
    addAddressAction.bind(null, customerId),
    { error: null } as FormState,
    { resetOnSuccess: true }
  );

  return (
    <form {...formProps} className="card-base p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 border-b border-line pb-2">
        <MapPin className="h-3.5 w-3.5 text-ink" />
        <h4 className="text-xs font-semibold text-ink">Add Delivery Address</h4>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <input
          name="label"
          type="text"
          placeholder="Label (e.g. Balogun Store, Ikeja Warehouse)"
          className={`${inputClass} sm:w-48 text-xs`}
        />
        <input
          name="street"
          type="text"
          required
          placeholder="Street address &amp; landmarks…"
          className={`${inputClass} flex-1 text-xs`}
        />
        <input
          name="city"
          type="text"
          required
          placeholder="City (e.g. Lagos)"
          className={`${inputClass} sm:w-32 text-xs`}
        />
      </div>

      <div className="flex items-center justify-between pt-1">
        <Feedback error={state.error} done={Boolean(state.saved) && !pending} />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-paper transition-all hover:bg-ink/90 disabled:opacity-60 shadow-xs ml-auto"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          <span>{pending ? "Adding…" : "Add Address"}</span>
        </button>
      </div>
    </form>
  );
}

export function AgreedPriceForm({
  customerId,
  products,
}: {
  customerId: string;
  products: { id: string; label: string; priceNaira: number }[];
}) {
  const { state, pending, formProps } = useSubmitAction(
    setPriceAction.bind(null, customerId),
    { error: null } as FormState,
    { resetOnSuccess: true }
  );

  return (
    <form {...formProps} className="card-base p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 border-b border-line pb-2">
        <Tag className="h-3.5 w-3.5 text-ink" />
        <h4 className="text-xs font-semibold text-ink">Set Agreed Wholesale Price</h4>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <select name="productId" required className={`${inputClass} flex-1 text-xs`}>
          <option value="">Select product SKU…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} — Standard ₦{p.priceNaira.toLocaleString("en-NG")}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1 sm:w-40">
          <span className="text-xs text-text-muted font-medium">₦</span>
          <input
            name="priceNaira"
            type="number"
            min="1"
            step="any"
            required
            placeholder="Agreed price"
            className={`${inputClass} w-full text-xs font-tabular text-right`}
          />
        </div>
      </div>

      <div className="flex items-center justify-between pt-1">
        <Feedback error={state.error} done={Boolean(state.saved) && !pending} />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-paper transition-all hover:bg-ink/90 disabled:opacity-60 shadow-xs ml-auto"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          <span>{pending ? "Saving…" : "Save Agreed Price"}</span>
        </button>
      </div>
    </form>
  );
}
