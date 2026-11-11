"use client";

import { useSubmitAction } from "@/lib/use-submit-action";
import { mergeCustomersAction, type FormState } from "../../actions";
import { GitMerge, Loader2 } from "lucide-react";

export function MergeForm({
  sourceId,
  targetId,
  sourceLabel,
  targetLabel,
}: {
  sourceId: string;
  targetId: string;
  sourceLabel: string;
  targetLabel: string;
}) {
  const { state, pending, formProps } = useSubmitAction(
    mergeCustomersAction.bind(null, sourceId, targetId),
    { error: null } as FormState
  );

  return (
    <form
      {...formProps}
      onSubmit={(e) => {
        if (!window.confirm(`Merge ${sourceLabel} into ${targetLabel}? This will consolidate orders and conversations.`)) {
          e.preventDefault();
          return;
        }
        formProps.onSubmit(e);
      }}
      className="card-base p-5 flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="note" className="text-xs font-semibold text-ink">
          Merge Justification & Audit Note
        </label>
        <input
          id="note"
          name="note"
          required
          placeholder="e.g. Verified customer has two WhatsApp lines; requested consolidation"
          className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink"
        />
        <p className="text-xs text-text-muted">
          This note is permanently recorded in the immutable audit trail for both customer identities.
        </p>
      </div>

      {state.error && (
        <p role="alert" className="text-xs font-medium text-status-attention-fg">
          {state.error}
        </p>
      )}

      <div className="flex items-center justify-end">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-paper transition-all hover:bg-accent-2 disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <GitMerge className="h-4 w-4" />
          )}
          <span>{pending ? "Merging Records…" : `Merge Into ${targetLabel}`}</span>
        </button>
      </div>
    </form>
  );
}
