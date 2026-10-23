"use client";


import { useSubmitAction } from "@/lib/use-submit-action";
import { addAddressAction, setPriceAction, updateCustomerAction, type FormState } from "../actions";

const inputClass =
  "rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10";
const buttonClass =
  "rounded-md border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-paper disabled:opacity-60";

function Feedback({ error, done }: { error: string | null; done: boolean }) {
  if (error) {
    return (
      <p role="alert" className="text-sm text-status-attention-fg">
        {error}
      </p>
    );
  }
  return done ? <p className="text-sm text-status-success-fg">Saved.</p> : null;
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
  const { state, pending, formProps } = useSubmitAction(updateCustomerAction.bind(null, customerId), {
    error: null,
  } as FormState);
  return (
    <form {...formProps} className="flex max-w-xl flex-col gap-4 rounded-md border border-line bg-surface p-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="text-sm font-medium text-ink">Name</label>
          <input id="name" name="name" defaultValue={name ?? ""} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium text-ink">Email</label>
          <input id="email" name="email" type="email" defaultValue={email ?? ""} className={inputClass} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className="text-sm font-medium text-ink">Notes</label>
        <textarea id="notes" name="notes" rows={3} defaultValue={notes ?? ""} className={inputClass} />
      </div>
      <div className="flex items-center gap-4">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Saving…" : "Save changes"}
        </button>
        <Feedback error={state.error} done={Boolean(state.saved) && !pending} />
      </div>
    </form>
  );
}

export function AddAddressForm({ customerId }: { customerId: string }) {
  const { state, pending, formProps } = useSubmitAction(addAddressAction.bind(null, customerId), {
    error: null,
  } as FormState, { resetOnSuccess: true });
  return (
    <form {...formProps} className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4">
      <div className="grid gap-3 md:grid-cols-[10rem_1fr]">
        <input name="label" placeholder="Label (e.g. Shop)" aria-label="Address label" className={inputClass} />
        <input name="text" required placeholder="Full address" aria-label="Address" className={inputClass} />
      </div>
      <div className="flex items-center gap-4">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Adding…" : "Add address"}
        </button>
        {state.error && <Feedback error={state.error} done={false} />}
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
  const { state, pending, formProps } = useSubmitAction(setPriceAction.bind(null, customerId), {
    error: null,
  } as FormState, { resetOnSuccess: true });
  return (
    <form {...formProps} className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4">
      <div className="grid gap-3 md:grid-cols-[1fr_10rem]">
        <select name="productId" aria-label="Product" className={inputClass} defaultValue="">
          <option value="" disabled>
            Choose a product…
          </option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} — list ₦{p.priceNaira.toLocaleString("en-NG")}
            </option>
          ))}
        </select>
        <input
          name="priceNaira"
          type="number"
          min="1"
          step="any"
          required
          placeholder="Agreed price ₦"
          aria-label="Agreed price in naira"
          className={inputClass}
        />
      </div>
      <div className="flex items-center gap-4">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Saving…" : "Set agreed price"}
        </button>
        {state.error && <Feedback error={state.error} done={false} />}
      </div>
    </form>
  );
}
