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
    <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-ink">AI product-matching assist</p>
          <p className="text-xs text-text-muted">
            Searches the catalogue and proposes a reply — drafts an order if confident, never
            confirms one.
          </p>
        </div>
        <form action={formAction}>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md border border-line bg-paper px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-line/40 disabled:opacity-60"
          >
            {pending ? "Thinking…" : "Let AI respond"}
          </button>
        </form>
      </div>

      {state.error && <p className="text-sm text-status-attention-fg">{state.error}</p>}

      {state.replyText && (
        <div className="rounded-md border border-line bg-paper p-3 text-sm">
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
