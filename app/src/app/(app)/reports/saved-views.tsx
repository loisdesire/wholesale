"use client";

import { useActionState, useState } from "react";
import { useSubmitAction } from "@/lib/use-submit-action";
import { deleteReportViewAction, saveReportViewAction, type FormState } from "./actions";
import type { ReportViewSummary } from "@/lib/report-views";

/**
 * Saved views are a shared team convenience, not a permission boundary — any staff
 * member can save the range they're looking at, or remove one somebody else saved.
 */
export function SavedViews({
  views,
  from,
  to,
  rangeLabel,
}: {
  views: ReportViewSummary[];
  from: string;
  to: string;
  rangeLabel: string;
}) {
  const [showSave, setShowSave] = useState(false);
  const { state, pending, formProps } = useSubmitAction(saveReportViewAction, { error: null } as FormState, {
    resetOnSuccess: true,
  });

  // Collapse the save panel once a save actually succeeds — adjusted during render
  // (React's own recommended pattern), not in an effect, which would cause an
  // avoidable extra render on every submit regardless of outcome.
  const [lastSeenState, setLastSeenState] = useState(state);
  if (state !== lastSeenState) {
    setLastSeenState(state);
    if (state.saved && !state.error) setShowSave(false);
  }

  return (
    <div className="flex flex-col gap-2">
      {views.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {views.map((v) => (
            <SavedViewPill key={v.id} view={v} />
          ))}
        </div>
      )}

      {showSave ? (
        <form {...formProps} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="to" value={to} />
          <input
            name="name"
            autoFocus
            placeholder={`e.g. "${rangeLabel}"`}
            maxLength={60}
            className="input input-sm"
          />
          <button
            type="submit"
            disabled={pending}
            className="btn btn-primary btn-sm"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setShowSave(false)}
            className="text-sm text-text-muted hover:text-ink"
          >
            Cancel
          </button>
          {state.error && <span className="text-sm text-status-attention-fg">{state.error}</span>}
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowSave(true)}
          className="btn btn-secondary btn-sm self-start"
        >
          Save this range as a view
        </button>
      )}
    </div>
  );
}

function SavedViewPill({ view }: { view: ReportViewSummary }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async () => deleteReportViewAction(view.id),
    { error: null }
  );
  const qs = `from=${view.fromDate.toISOString().slice(0, 10)}&to=${view.toDate.toISOString().slice(0, 10)}`;

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface py-1 pl-3 pr-1 text-xs">
      <a href={`/reports?${qs}`} className="text-ink hover:underline">
        {view.name}
      </a>
      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          aria-label={`Remove saved view "${view.name}"`}
          title="Remove this saved view"
          className="rounded-full px-1.5 text-text-muted hover:bg-line/60 hover:text-status-attention-fg disabled:opacity-60"
        >
          ×
        </button>
      </form>
      {state.error && <span className="text-status-attention-fg">{state.error}</span>}
    </span>
  );
}
