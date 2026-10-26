"use client";

import { useSubmitAction } from "@/lib/use-submit-action";
import { sendReplyAction } from "../actions";

export function ReplyForm({ conversationId }: { conversationId: string }) {
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
        placeholder="Type a reply to send over WhatsApp…"
        required
        className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
      />
      {state.error && (
        <p role="alert" className="text-sm text-status-attention-fg">
          {state.error}
        </p>
      )}
      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-accent-2 disabled:opacity-60"
        >
          {pending ? "Sending…" : "Send reply"}
        </button>
      </div>
    </form>
  );
}
