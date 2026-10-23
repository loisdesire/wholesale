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
}: {
  action: (prevState: FormState) => Promise<FormState>;
  label: string;
  pendingLabel: string;
  variant?: "primary" | "danger";
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });

  return (
    <form action={formAction} className="flex items-center gap-3">
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

export function OrderActions({ orderId, status }: { orderId: string; status: string }) {
  if (status === "DRAFT") {
    return (
      <div className="flex flex-wrap gap-4">
        <ActionButton
          action={confirmOrderAction.bind(null, orderId)}
          label="Confirm order"
          pendingLabel="Confirming…"
        />
        <ActionButton
          action={cancelOrderAction.bind(null, orderId)}
          label="Cancel order"
          pendingLabel="Cancelling…"
          variant="danger"
        />
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
      <ActionButton
        action={markFulfilledAction.bind(null, orderId)}
        label="Mark as fulfilled"
        pendingLabel="Saving…"
      />
    );
  }

  return null;
}
