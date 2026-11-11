"use client";

import { useActionState } from "react";
import { useSubmitAction } from "@/lib/use-submit-action";
import { extendTrialAction, markSubscriptionActiveAction, type FormState } from "./actions";
import type { SubscriptionStatus } from "@prisma/client";

/**
 * The only two edits a platform admin can make (see platform-admin.ts) — everything
 * else about an organization stays read-only here by design.
 */
export function AdminRowActions({ organizationId, status }: { organizationId: string; status: SubscriptionStatus }) {
  if (status === "TRIALING") return <ExtendTrialForm organizationId={organizationId} />;
  if (status === "PAST_DUE") return <MarkActiveButton organizationId={organizationId} />;
  return <span className="text-text-muted">—</span>;
}

function ExtendTrialForm({ organizationId }: { organizationId: string }) {
  const { state, pending, formProps } = useSubmitAction(
    extendTrialAction.bind(null, organizationId),
    { error: null } as FormState,
    { resetOnSuccess: false }
  );

  return (
    <form {...formProps} className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          name="days"
          min={1}
          max={90}
          defaultValue={7}
          className="w-14 rounded-md border border-line bg-surface px-1.5 py-1 text-right font-tabular text-xs text-ink"
        />
        <span className="text-xs text-text-muted">days</span>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink hover:bg-paper disabled:opacity-60"
        >
          {pending ? "Extending…" : "Extend trial"}
        </button>
      </div>
      {state.error && <span className="text-xs text-status-attention-fg">{state.error}</span>}
      {state.saved && !state.error && <span className="text-xs text-status-success-fg">Extended.</span>}
    </form>
  );
}

function MarkActiveButton({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async () => markSubscriptionActiveAction(organizationId),
    { error: null }
  );

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink hover:bg-paper disabled:opacity-60"
      >
        {pending ? "Updating…" : "Mark active"}
      </button>
      {state.error && <span className="text-xs text-status-attention-fg">{state.error}</span>}
    </form>
  );
}
