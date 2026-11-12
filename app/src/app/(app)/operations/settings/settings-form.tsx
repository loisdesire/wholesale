"use client";

import { useSubmitAction } from "@/lib/use-submit-action";
import { updateSlaSettingsAction, type FormState } from "./actions";
import { SLA_FIELDS, type SlaKey, type SlaOverrides, type SlaThresholds } from "@/lib/ops-config";

const inputClass =
  "w-24 input input-sm font-tabular";

export function SlaSettingsForm({
  overrides,
  defaults,
}: {
  overrides: SlaOverrides;
  defaults: SlaThresholds;
}) {
  const { state, pending, formProps } = useSubmitAction(updateSlaSettingsAction, { error: null } as FormState, {
    resetOnSuccess: false,
  });

  const groups = [...new Set(SLA_FIELDS.map((f) => f.group))];

  return (
    <form {...formProps} className="flex flex-col gap-8">
      {groups.map((group) => (
        <fieldset key={group} className="flex flex-col gap-3">
          <legend className="text-sm font-medium text-ink">{group}</legend>
          <div className="flex flex-col gap-2">
            {SLA_FIELDS.filter((f) => f.group === group).map((f) => (
              <label key={f.key} className="flex items-center justify-between gap-4 text-sm text-text-muted">
                <span>{f.label}</span>
                <span className="flex items-center gap-2">
                  <input
                    type="number"
                    name={f.key}
                    min={1}
                    placeholder={String(defaults[f.key])}
                    defaultValue={overrides[f.key as SlaKey] ?? ""}
                    className={inputClass}
                  />
                  <span className="text-xs text-text-muted">hours (default {defaults[f.key]})</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="btn btn-primary"
        >
          {pending ? "Saving…" : "Save thresholds"}
        </button>
        {state.error && <span className="text-sm text-status-attention-fg">{state.error}</span>}
        {state.saved && !state.error && <span className="text-sm text-status-success-fg">Saved.</span>}
      </div>
      <p className="text-xs text-text-muted">
        Leave a field blank to use its default. These numbers control when the needs-attention queue and the
        overdue metrics call something a warning or critical exception — they take effect immediately.
      </p>
    </form>
  );
}
