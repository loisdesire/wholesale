"use client";

import { useSubmitAction } from "@/lib/use-submit-action";
import { updateCustomerMessagesAction, type FormState } from "./actions";

/** Owner switch: send customers a message when an order ships. */
export function CustomerMessagesForm({ notifyOnShip, aiAutoReply }: { notifyOnShip: boolean; aiAutoReply: boolean }) {
  const { state, pending, formProps } = useSubmitAction(updateCustomerMessagesAction, { error: null } as FormState, {
    resetOnSuccess: false,
  });

  return (
    <form {...formProps} className="card flex max-w-3xl flex-col gap-3 p-5">
      <h2 className="section-title">Messages to customers</h2>
      <label className="flex items-start gap-3 text-sm text-ink">
        <input type="checkbox" name="notifyOnShip" defaultChecked={notifyOnShip} className="mt-1 size-4" />
        <span>
          Message the customer when an order ships
          <span className="block text-xs text-text-muted">
            Sent in their existing WhatsApp or Telegram chat, with a link to follow the order. If it can&apos;t be sent, the
            shipment still goes through and you can copy the link from the order page.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-3 text-sm text-ink">
        <input type="checkbox" name="aiAutoReply" defaultChecked={aiAutoReply} className="mt-1 size-4" />
        <span>
          Let the AI reply to new customer messages straight away
          <span className="block text-xs text-text-muted">
            Applies to WhatsApp and Telegram. It answers from your catalogue and can only draft orders, never confirm them.
            Turn it off to review every chat yourself and press &quot;Let AI respond&quot; when you want a draft.
          </span>
        </span>
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary btn-sm">
          {pending ? "Saving…" : "Save"}
        </button>
        {state.error && <span className="text-sm text-status-attention-fg">{state.error}</span>}
        {state.saved && !state.error && <span className="text-sm text-status-success-fg">Saved.</span>}
      </div>
    </form>
  );
}
