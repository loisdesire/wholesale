"use client";

import { useActionState } from "react";
import { useSubmitAction } from "@/lib/use-submit-action";
import { extendTrialAction, markSubscriptionActiveAction, type FormState } from "./actions";
import type { SubscriptionStatus } from "@prisma/client";
import { Clock, CheckCircle2, Loader2, Check } from "lucide-react";

/**
 * The only two edits a platform admin can make (see platform-admin.ts) — everything
 * else about an organization stays read-only here by design.
 */
export function AdminRowActions({ organizationId, status }: { organizationId: string; status: SubscriptionStatus }) {
  if (status === "TRIALING") return <ExtendTrialForm organizationId={organizationId} />;
  if (status === "PAST_DUE") return <MarkActiveButton organizationId={organizationId} />;
  if (status === "ACTIVE") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-status-success-bg/70 px-2.5 py-0.5 text-xs font-medium text-status-success-fg">
        <Check className="h-3 w-3" /> Normal
      </span>
    );
  }
  return <span className="text-xs text-text-muted italic">—</span>;
}

function ExtendTrialForm({ organizationId }: { organizationId: string }) {
  const { state, pending, formProps } = useSubmitAction(
    extendTrialAction.bind(null, organizationId),
    { error: null } as FormState,
    { resetOnSuccess: false }
  );

  return (
    <form {...formProps} className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <div className="flex items-center overflow-hidden rounded-md border border-line bg-surface focus-within:border-ink focus-within:ring-1 focus-within:ring-ink">
          <span className="pl-2 text-xs text-text-muted font-medium">+</span>
          <input
            type="number"
            name="days"
            min={1}
            max={90}
            defaultValue={7}
            className="w-10 bg-transparent px-1 py-1 text-center font-tabular text-xs font-medium text-ink outline-none"
          />
          <span className="pr-1.5 text-xs text-text-muted">days</span>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md bg-ink px-2.5 py-1 text-xs font-medium text-paper transition-all hover:bg-ink/90 disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Clock className="h-3 w-3" />
          )}
          <span>{pending ? "Saving…" : "Extend"}</span>
        </button>
      </div>
      {state.error && <span className="text-xs font-medium text-status-attention-fg">{state.error}</span>}
      {state.saved && !state.error && (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-status-success-fg">
          <Check className="h-3 w-3" /> Extended
        </span>
      )}
    </form>
  );
}

function MarkActiveButton({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async () => markSubscriptionActiveAction(organizationId),
    { error: null }
  );

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md border border-status-success-fg/30 bg-status-success-bg px-2.5 py-1 text-xs font-medium text-status-success-fg transition-all hover:bg-status-success-fg hover:text-white disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5" />
        )}
        <span>{pending ? "Updating…" : "Mark active"}</span>
      </button>
      {state.error && <span className="text-xs font-medium text-status-attention-fg">{state.error}</span>}
    </form>
  );
}
