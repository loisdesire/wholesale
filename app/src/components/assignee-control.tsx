"use client";

import { useSubmitAction } from "@/lib/use-submit-action";
import { assignAction, type FormState } from "@/app/(app)/operations/actions";
import type { AssignableKind } from "@/lib/assignment";

const selectClass =
  "rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10";

/**
 * Who this piece of work is assigned to, with a picker to change it. Owners can
 * assign anyone; staff can only take unassigned work or put back their own
 * (the server is the real enforcement — this just reflects it so the control
 * doesn't offer a choice that will be refused).
 */
export function AssigneeControl({
  kind,
  id,
  currentAssigneeId,
  members,
  isOwner,
  currentUserId,
}: {
  kind: AssignableKind;
  id: string;
  currentAssigneeId: string | null;
  members: { id: string; name: string; role: string }[];
  isOwner: boolean;
  currentUserId: string;
}) {
  const { state, pending, formProps } = useSubmitAction(assignAction.bind(null, kind, id), { error: null } as FormState, {
    resetOnSuccess: false,
  });

  const options = isOwner
    ? members
    : members.filter((m) => m.id === currentUserId || m.id === currentAssigneeId);
  const canOfferUnassigned = isOwner || currentAssigneeId === null || currentAssigneeId === currentUserId;

  return (
    <form {...formProps} className="flex items-center gap-2">
      <select
        name="assigneeId"
        aria-label="Assigned to"
        defaultValue={currentAssigneeId ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        disabled={pending}
        className={selectClass}
      >
        {canOfferUnassigned && <option value="">Unassigned</option>}
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.id === currentUserId ? `${m.name} (you)` : m.name}
          </option>
        ))}
      </select>
      {state.error && <span className="text-xs text-status-attention-fg">{state.error}</span>}
    </form>
  );
}
