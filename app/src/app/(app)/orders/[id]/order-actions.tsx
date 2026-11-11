"use client";

import { useActionState } from "react";
import {
  confirmOrderAction,
  markPaidAction,
  markFulfilledAction,
  cancelOrderAction,
  type FormState,
} from "../actions";
import { PaymentLinkButton } from "./payment-link-button";
import { AlertCircle } from "lucide-react";

function ActionButton({
  action,
  label,
  pendingLabel,
  variant = "primary",
  confirmMessage,
}: {
  action: (prevState: FormState) => Promise<FormState>;
  label: string;
  pendingLabel: string;
  variant?: "primary" | "secondary" | "danger";
  /** Ask "are you sure?" before running — for actions that move money. */
  confirmMessage?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) e.preventDefault();
      }}
      className="inline-flex items-center gap-2"
    >
      <button
        type="submit"
        disabled={pending}
        className={
          variant === "primary"
            ? "inline-flex min-h-[40px] items-center justify-center gap-1.5 bg-accent px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent-2 disabled:opacity-60 cursor-pointer"
            : variant === "danger"
              ? "inline-flex min-h-[40px] items-center justify-center gap-1.5 border border-rose-200 bg-rose-50/60 px-4 py-2 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-60 cursor-pointer"
              : "inline-flex min-h-[40px] items-center justify-center gap-1.5 border border-line bg-surface px-4 py-2 text-xs font-semibold text-ink transition-colors hover:bg-paper disabled:opacity-60 cursor-pointer"
        }
      >
        {pending ? pendingLabel : label}
      </button>
      {state.error && <p className="text-xs font-medium text-rose-700">{state.error}</p>}
    </form>
  );
}

export function OrderActions({
  orderId,
  status,
  isOwner,
  duplicateOf,
}: {
  orderId: string;
  status: string;
  isOwner: boolean;
  /** References of orders this one looks like a repeat of. */
  duplicateOf: string[];
}) {
  if (status === "DRAFT") {
    const repeat = duplicateOf.length > 0;
    return (
      <div className="flex flex-col gap-3">
        {repeat && (
          <div role="status" className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
            <p>
              <strong>Possible Repeat Order:</strong> {duplicateOf.join(", ")} contains the same customer and items in the last 24h. Verify before confirming to prevent accidental double-billing.
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton
            action={confirmOrderAction.bind(null, orderId, repeat)}
            label={repeat ? "Confirm anyway — intended order" : "Confirm & Reserve Stock"}
            pendingLabel="Confirming…"
            confirmMessage={repeat ? `This looks like a repeat of ${duplicateOf.join(", ")}. Confirm it anyway?` : undefined}
          />
          <ActionButton
            action={cancelOrderAction.bind(null, orderId)}
            label="Cancel draft"
            pendingLabel="Cancelling…"
            variant="danger"
          />
        </div>
      </div>
    );
  }

  if (status === "CONFIRMED") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton
          action={markPaidAction.bind(null, orderId)}
          label="Record Manual Payment"
          pendingLabel="Recording…"
        />
        <PaymentLinkButton orderId={orderId} />
        <ActionButton
          action={cancelOrderAction.bind(null, orderId)}
          label="Cancel Order"
          pendingLabel="Cancelling…"
          variant="danger"
        />
      </div>
    );
  }

  if (status === "PAID") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton
          action={markFulfilledAction.bind(null, orderId)}
          label="Dispatch & Fulfill Remaining"
          pendingLabel="Saving…"
        />
        {isOwner ? (
          <ActionButton
            action={cancelOrderAction.bind(null, orderId)}
            label="Cancel & Void to Refund"
            pendingLabel="Cancelling…"
            variant="danger"
            confirmMessage="Cancel this paid order? Its reserved stock is released and the full amount becomes an outstanding refund owed to the customer."
          />
        ) : (
          <span className="text-xs text-text-muted">Cancellations on settled orders require owner approval.</span>
        )}
      </div>
    );
  }

  if (status === "PARTIALLY_FULFILLED") {
    return (
      <ActionButton
        action={markFulfilledAction.bind(null, orderId)}
        label="Dispatch & Fulfill Remaining"
        pendingLabel="Saving…"
      />
    );
  }

  return null;
}
