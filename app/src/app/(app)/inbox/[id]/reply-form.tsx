"use client";

import { useSubmitAction } from "@/lib/use-submit-action";
import { sendReplyAction } from "../actions";

export function ReplyForm({ conversationId, channel = "WHATSAPP" }: { conversationId: string; channel?: string }) {
  const channelName = channel === "TELEGRAM" ? "Telegram" : "WhatsApp";
  // Clears the box only once a reply actually sends; a failed send keeps the text.
  const { state, pending, formProps } = useSubmitAction(
    sendReplyAction.bind(null, conversationId),
    { error: null },
    { resetOnSuccess: true }
  );

  return (
    <form {...formProps} className="flex flex-col gap-3">
      <textarea
        name="body"
        rows={3}
        placeholder={`Type a reply to send on ${channelName}…`}
        required
        className="input"
      />
      {state.error && (
        <p role="alert" className="text-sm text-status-attention-fg">
          {state.error}
        </p>
      )}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="btn btn-primary"
        >
          {pending ? "Sending…" : `Send on ${channelName}`}
        </button>
      </div>
    </form>
  );
}
