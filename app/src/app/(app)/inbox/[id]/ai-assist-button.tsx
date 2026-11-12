"use client";

import { useActionState } from "react";
import Link from "next/link";
import { runAIAssistAction, type AIAssistState } from "../actions";

const initialState: AIAssistState = { error: null };

export function AIAssistButton({ conversationId }: { conversationId: string }) {
  const [state, formAction, pending] = useActionState(
    runAIAssistAction.bind(null, conversationId),
    initialState
  );

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-accent/20 bg-accent-soft p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">AI assist</p>
          <p className="text-xs text-text-muted">
            Drafts a reply from your catalogue. Never confirms an order.
          </p>
        </div>
        <form action={formAction}>
          <button
            type="submit"
            disabled={pending}
            className="btn btn-secondary btn-sm"
          >
            {pending ? "Thinking…" : "Let AI respond"}
          </button>
        </form>
      </div>

      {state.error && <p className="text-sm text-status-attention-fg">{state.error}</p>}

      {state.replyText && (
        <div className="rounded-xl border border-line bg-surface p-3.5 text-sm">
          <p className="mb-1 text-xs font-medium text-text-muted">
            {state.sent ? "Sent to customer" : "Proposed reply — not sent"}
          </p>
          <p className="whitespace-pre-wrap text-ink">{state.replyText}</p>
          {!state.sent && (
            <p className="mt-2 text-xs text-status-attention-fg">
              WhatsApp isn&apos;t configured, so this wasn&apos;t sent — copy it manually if you
              want to use it.
            </p>
          )}
          {state.draftOrderReference && (
            <p className="mt-2 text-xs text-text-muted">
              Drafted order{" "}
              <Link
                href={`/orders`}
                className="font-tabular text-ink underline underline-offset-2"
              >
                {state.draftOrderReference}
              </Link>{" "}
              — still needs confirming.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
