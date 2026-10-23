"use client";


import { useSubmitAction } from "@/lib/use-submit-action";
import { updateItemQuantityAction, updateOrderDetailsAction, type FormState } from "../actions";

const inputClass =
  "rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10";

/** Inline "change quantity" on a draft order line. The server re-prices the line. */
export function QuantityForm({
  orderId,
  orderItemId,
  quantity,
  moq,
}: {
  orderId: string;
  orderItemId: string;
  quantity: number;
  moq: number;
}) {
  const { state, pending, formProps } = useSubmitAction(
    updateItemQuantityAction.bind(null, orderId, orderItemId),
    { error: null } as FormState
  );
  return (
    <form {...formProps} className="flex items-center justify-end gap-2">
      <input
        name="quantity"
        type="number"
        min={moq}
        step={1}
        defaultValue={quantity}
        key={quantity}
        aria-label="Quantity"
        className={`${inputClass} w-20 px-2 py-1 text-right font-tabular`}
      />
      <button type="submit" disabled={pending} className="text-xs text-ink underline-offset-2 hover:underline disabled:opacity-60">
        {pending ? "Saving…" : "Update"}
      </button>
      {state.error && (
        <span role="alert" className="max-w-48 text-xs text-status-attention-fg">
          {state.error}
        </span>
      )}
    </form>
  );
}

export function OrderDetailsForm({
  orderId,
  notes,
  deliveryAddress,
  addressOptions,
  editable,
}: {
  orderId: string;
  notes: string | null;
  deliveryAddress: string | null;
  addressOptions: { id: string; label: string | null; text: string }[];
  editable: boolean;
}) {
  const { state, pending, formProps } = useSubmitAction(
    updateOrderDetailsAction.bind(null, orderId),
    { error: null } as FormState
  );

  if (!editable) {
    return (
      <dl className="grid gap-4 rounded-md border border-line bg-surface p-4 text-sm md:grid-cols-2">
        <div>
          <dt className="text-xs text-text-muted">Delivery address</dt>
          <dd className="mt-1 whitespace-pre-wrap text-ink">{deliveryAddress ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Notes</dt>
          <dd className="mt-1 whitespace-pre-wrap text-ink">{notes ?? "—"}</dd>
        </div>
      </dl>
    );
  }

  return (
    <form {...formProps} className="flex flex-col gap-4 rounded-md border border-line bg-surface p-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="deliveryAddress" className="text-sm font-medium text-ink">
            Delivery address
          </label>
          <textarea
            id="deliveryAddress"
            name="deliveryAddress"
            rows={3}
            defaultValue={deliveryAddress ?? ""}
            className={inputClass}
          />
          {addressOptions.length > 0 && (
            <p className="text-xs text-text-muted">
              Saved for this customer:{" "}
              {addressOptions.map((a) => a.label ?? a.text.slice(0, 30)).join(" · ")}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="notes" className="text-sm font-medium text-ink">
            Notes
          </label>
          <textarea id="notes" name="notes" rows={3} defaultValue={notes ?? ""} className={inputClass} />
        </div>
      </div>
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
          {pending ? "Saving…" : "Save details"}
        </button>
      </div>
    </form>
  );
}
