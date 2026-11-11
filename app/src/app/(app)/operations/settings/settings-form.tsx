"use client";

import { useSubmitAction } from "@/lib/use-submit-action";
import { updateSlaSettingsAction, type FormState } from "./actions";
import { SLA_FIELDS, type SlaKey, type SlaOverrides, type SlaThresholds } from "@/lib/ops-config";
import { Save, Loader2, Check } from "lucide-react";

export function SlaSettingsForm({
  overrides,
  defaults,
}: {
  overrides: SlaOverrides;
  defaults: SlaThresholds;
}) {
  const { state, pending, formProps } = useSubmitAction(
    updateSlaSettingsAction, 
    { error: null } as FormState, 
    { resetOnSuccess: false }
  );

  const groups = [...new Set(SLA_FIELDS.map((f) => f.group))];

  return (
    <form {...formProps} className="flex flex-col gap-6">
      {groups.map((group) => (
        <fieldset key={group} className="card-base overflow-hidden">
          <div className="border-b border-line bg-paper/50 px-5 py-3">
            <legend className="text-xs font-semibold text-ink">
              {group}
            </legend>
          </div>
          <div className="divide-y divide-line p-2">
            {SLA_FIELDS.filter((f) => f.group === group).map((f) => (
              <label 
                key={f.key} 
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-3 py-3 hover:bg-paper/20 rounded-md transition-colors"
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-ink">{f.label}</span>
                  <span className="text-xs text-text-muted">Standard baseline is {defaults[f.key]} hours</span>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <div className="flex items-center overflow-hidden rounded-md border border-line bg-surface focus-within:border-ink focus-within:ring-1 focus-within:ring-ink">
                    <input
                      type="number"
                      name={f.key}
                      min={1}
                      placeholder={String(defaults[f.key])}
                      defaultValue={overrides[f.key as SlaKey] ?? ""}
                      className="w-20 bg-transparent px-2.5 py-1.5 text-right font-tabular text-sm font-medium text-ink outline-none"
                    />
                    <span className="bg-paper/60 px-2 py-1.5 text-xs text-text-muted font-medium border-l border-line">
                      hours
                    </span>
                  </div>
                </div>
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      {state.error && (
        <div className="rounded-md border border-status-attention-fg/30 bg-status-attention-bg p-3 text-xs text-status-attention-fg">
          {state.error}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-line pt-4">
        <p className="text-xs text-text-muted max-w-md">
          Blank inputs inherit system defaults. Changes take effect on the operational queue immediately.
        </p>

        <div className="flex items-center gap-3">
          {state.saved && !state.error && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-status-success-fg">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-paper transition-all hover:bg-accent-2 disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            <span>{pending ? "Saving…" : "Save Thresholds"}</span>
          </button>
        </div>
      </div>
    </form>
  );
}
