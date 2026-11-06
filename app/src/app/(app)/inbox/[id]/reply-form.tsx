"use client";

import { useSubmitAction } from "@/lib/use-submit-action";
import { sendReplyAction } from "../actions";
import { Send, Loader2 } from "lucide-react";

export function ReplyForm({
  conversationId,
  channel = "WHATSAPP",
}: {
  conversationId: string;
  channel?: "WHATSAPP" | "TELEGRAM" | string;
}) {
  const { state, pending, formProps } = useSubmitAction(
    sendReplyAction.bind(null, conversationId),
    { error: null },
    { resetOnSuccess: true }
  );

  const isTelegram = channel === "TELEGRAM";
  const channelName = isTelegram ? "Telegram" : "WhatsApp";

  return (
    <form {...formProps} className="flex flex-col gap-2">
      <div className="relative flex flex-col rounded-2xl border border-line bg-surface p-2 shadow-xs focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/10 transition-all">
        <textarea
          name="body"
          rows={3}
          placeholder={`Type a ${channelName} message to the customer… (Enter to add lines)`}
          required
          className="w-full resize-none bg-transparent px-3 py-2 text-base sm:text-sm text-ink placeholder:text-text-muted/60 outline-none"
        />

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 border-t border-line/60 pt-2 px-1">
          <span className="text-xs text-text-muted">
            Will be delivered instantly to customer&apos;s {channelName}
          </span>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-[44px] sm:min-h-[38px] items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-accent/20 transition-all hover:bg-accent-2 hover:shadow-md hover:shadow-accent/30 active:scale-95 disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
          >
            {pending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Sending…</span>
              </>
            ) : (
              <>
                <span>Send {channelName}</span>
                <Send className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      </div>

      {state.error && (
        <p role="alert" className="text-xs font-medium text-status-attention-fg animate-in fade-in">
          {state.error}
        </p>
      )}
    </form>
  );
}
