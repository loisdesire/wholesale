"use client";

import { useSubmitAction } from "@/lib/use-submit-action";
import { mergeCustomersAction, type FormState } from "../../actions";

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
  const { state, pending, formProps } = useSubmitAction(mergeCustomersAction.bind(null, sourceId, targetId), {
    error: null,
  } as FormState);
  return (
    <form
      {...formProps}
      onSubmit={(e) => {
        if (!window.confirm(`Merge ${sourceLabel} into ${targetLabel}? You can undo this afterwards.`)) {
          e.preventDefault();
          return;
        }
        formProps.onSubmit(e);
      }}
      className="flex flex-col gap-3 card p-5"
    >
      <label htmlFor="note" className="text-sm font-medium text-ink">
        Why these are the same person (kept in the history)
      </label>
      <input
        id="note"
        name="note"
        placeholder="e.g. confirmed by phone — she has two lines"
        className="input"
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
          className="btn btn-primary"
        >
          {pending ? "Merging…" : `Merge ${sourceLabel} into ${targetLabel}`}
        </button>
      </div>
    </form>
  );
}
