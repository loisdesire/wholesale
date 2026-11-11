"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { runAIAssistAction, type AIAssistState } from "../actions";
import { Sparkles, Loader2, ArrowRight, Check, Copy } from "lucide-react";

const initialState: AIAssistState = { error: null };

export function AIAssistButton({ conversationId }: { conversationId: string }) {
  const [copied, setCopied] = useState(false);
  const [state, formAction, pending] = useActionState(
    runAIAssistAction.bind(null, conversationId),
    initialState
  );

  const copyReply = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500/15 via-gold/15 to-amber-500/15 border border-gold/30 px-4 py-2.5 text-xs font-semibold text-ink transition-all hover:bg-gold/25 hover:border-gold/50 active:scale-98 disabled:opacity-60 cursor-pointer"
        >
          {pending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-gold" />
              <span>Matching catalogue items &amp; drafting…</span>
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5 text-gold" />
              <span>Analyze Inquiries &amp; Propose Reply</span>
            </>
          )}
        </button>
      </form>

      {state.error && (
        <p className="text-xs font-medium text-rose-700 bg-rose-50/70 border border-rose-200 p-2.5 rounded-xl">
          {state.error}
        </p>
      )}

      {state.replyText && (
        <div className="rounded-xl border border-line bg-paper/60 p-3.5 text-xs space-y-2.5 animate-in fade-in">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-xs text-ink">
              {state.sent ? "Sent to customer via WhatsApp" : "Proposed draft (pending review)"}
            </span>
            <button
              type="button"
              onClick={() => copyReply(state.replyText!)}
              className="inline-flex items-center gap-1 text-xs font-medium text-text-muted hover:text-ink cursor-pointer"
            >
              {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>

          <p className="whitespace-pre-wrap leading-relaxed text-ink bg-surface/80 p-2.5 rounded-lg border border-line/60">
            {state.replyText}
          </p>

          {!state.sent && (
            <p className="text-xs text-text-muted">
              WhatsApp provider not connected in this preview. Copy and paste into the message dock to dispatch.
            </p>
          )}

          {state.draftOrderReference && (
            <div className="flex items-center justify-between border-t border-line/60 pt-2 text-xs">
              <span className="text-text-muted">Draft order created:</span>
              <Link
                href={`/orders`}
                className="inline-flex items-center gap-1 font-mono font-bold text-accent hover:underline"
              >
                <span>{state.draftOrderReference}</span>
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
