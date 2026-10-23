"use client";

import { useActionState } from "react";
import {
  confirmOrderAction,
  markPaidAction,
  markFulfilledAction,
  cancelOrderAction,
  type FormState,
} from "../actions";

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
  variant?: "primary" | "danger";
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
      className="flex items-center gap-3"
    >
      <button
        type="submit"
        disabled={pending}
        className={
          variant === "primary"
            ? "rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-ink-2 disabled:opacity-60"
            : "rounded-md border border-line px-4 py-2 text-sm font-medium text-status-attention-fg transition-colors hover:bg-status-attention-bg disabled:opacity-60"
        }
      >
        {pending ? pendingLabel : label}
      </button>
      {state.error && <p className="text-sm text-status-attention-fg">{state.error}</p>}
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
      <div className="flex flex-col gap-4">
        {repeat && (
          <p role="status" className="rounded-md border border-line bg-status-attention-bg px-4 py-3 text-sm text-status-attention-fg">
            Possible repeat order: {duplicateOf.join(", ")} has the same customer and the same items from the last
            day. Check before confirming so the customer isn&apos;t charged twice.
          </p>
        )}
        <div className="flex flex-wrap gap-4">
        <ActionButton
          action={confirmOrderAction.bind(null, orderId, repeat)}
          label={repeat ? "Confirm anyway — it's intended" : "Confirm order"}
          pendingLabel="Confirming…"
          confirmMessage={repeat ? `This looks like a repeat of ${duplicateOf.join(", ")}. Confirm it anyway?` : undefined}
        />
        <ActionButton
          action={cancelOrderAction.bind(null, orderId)}
          label="Cancel order"
          pendingLabel="Cancelling…"
          variant="danger"
        />
        </div>
      </div>
    );
  }

  if (status === "CONFIRMED") {
    return (
      <div className="flex flex-wrap gap-4">
        <ActionButton action={markPaidAction.bind(null, orderId)} label="Mark as paid" pendingLabel="Saving…" />
        <ActionButton
          action={cancelOrderAction.bind(null, orderId)}
          label="Cancel order"
          pendingLabel="Cancelling…"
          variant="danger"
        />
      </div>
    );
  }

  if (status === "PAID") {
    return (
      <div className="flex flex-wrap gap-4">
        <ActionButton
          action={markFulfilledAction.bind(null, orderId)}
          label="Ship everything remaining"
          pendingLabel="Saving…"
        />
        {isOwner ? (
          <ActionButton
            action={cancelOrderAction.bind(null, orderId)}
            label="Cancel order and refund"
            pendingLabel="Cancelling…"
            variant="danger"
            confirmMessage="Cancel this paid order? Its stock is released and the full amount becomes a refund you owe the customer."
          />
        ) : (
          <p className="self-center text-sm text-text-muted">Cancelling a paid order means a refund — only an owner can do it.</p>
        )}
      </div>
    );
  }

  if (status === "PARTIALLY_FULFILLED") {
    return (
      <ActionButton
        action={markFulfilledAction.bind(null, orderId)}
        label="Ship everything remaining"
        pendingLabel="Saving…"
      />
    );
  }

  return null;
}
