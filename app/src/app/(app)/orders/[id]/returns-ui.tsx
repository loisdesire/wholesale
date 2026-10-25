"use client";


import { useActionState } from "react";
import { useSubmitAction } from "@/lib/use-submit-action";
import {
  decideReturnAction,
  markRefundedAction,
  receiveReturnAction,
  requestProviderRefundAction,
  requestReturnAction,
  type FormState,
  type RequestProviderRefundState,
} from "../returns-actions";

const inputClass =
  "rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10";
const primaryButton =
  "rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-ink-2 disabled:opacity-60";
const secondaryButton =
  "rounded-md border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-paper disabled:opacity-60";
const dangerButton =
  "rounded-md border border-line px-4 py-2 text-sm font-medium text-status-attention-fg transition-colors hover:bg-status-attention-bg disabled:opacity-60";

export type ReturnableLine = {
  orderItemId: string;
  label: string;
  sku: string;
  returnable: number;
  unit: string;
};

export function RequestReturnForm({ orderId, lines }: { orderId: string; lines: ReturnableLine[] }) {
  const { state, pending, formProps } = useSubmitAction(requestReturnAction.bind(null, orderId), {
    error: null,
  } as FormState, { resetOnSuccess: true });

  return (
    <form {...formProps} className="flex flex-col gap-4 rounded-md border border-line bg-surface p-4">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
              <th className="py-2 pr-4">Item</th>
              <th className="py-2 pr-4 text-right">Can still return</th>
              <th className="py-2 pr-4">Quantity</th>
              <th className="py-2">Condition</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.orderItemId} className="border-b border-line last:border-0">
                <td className="py-3 pr-4 text-ink">
                  {line.label}
                  <span className="ml-2 font-tabular text-xs text-text-muted">{line.sku}</span>
                </td>
                <td className="py-3 pr-4 text-right font-tabular text-text-muted">
                  {line.returnable} {line.unit}
                  {line.returnable === 1 ? "" : "s"}
                </td>
                <td className="py-3 pr-4">
                  <input
                    type="number"
                    name={`qty_${line.orderItemId}`}
                    min={0}
                    max={line.returnable}
                    step={1}
                    disabled={line.returnable === 0}
                    aria-label={`Quantity of ${line.label} to return`}
                    placeholder="0"
                    className={`${inputClass} w-24`}
                  />
                </td>
                <td className="py-3">
                  <select
                    name={`condition_${line.orderItemId}`}
                    disabled={line.returnable === 0}
                    aria-label={`Condition of ${line.label}`}
                    className={inputClass}
                  >
                    <option value="RESELLABLE">Resellable</option>
                    <option value="DAMAGED">Damaged</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="reason" className="text-sm font-medium text-ink">
          Reason for the return
        </label>
        <input
          id="reason"
          name="reason"
          type="text"
          required
          placeholder="e.g. wrong size, faulty zip"
          className={inputClass}
        />
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-status-attention-fg">
          {state.error}
        </p>
      )}
      <div>
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Submitting…" : "Request return"}
        </button>
      </div>
    </form>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-status-attention-fg">
      {error}
    </p>
  ) : null;
}

function NoteAction({
  action,
  label,
  pendingLabel,
  placeholder,
  variant = "primary",
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  label: string;
  pendingLabel: string;
  placeholder: string;
  variant?: "primary" | "danger" | "secondary";
}) {
  const { state, pending, formProps } = useSubmitAction(action, { error: null } as FormState);
  return (
    <form {...formProps} className="flex flex-wrap items-center gap-2">
      <input name="note" type="text" placeholder={placeholder} aria-label={placeholder} className={`${inputClass} w-64`} />
      <button
        type="submit"
        disabled={pending}
        className={variant === "primary" ? primaryButton : variant === "danger" ? dangerButton : secondaryButton}
      >
        {pending ? pendingLabel : label}
      </button>
      <ErrorLine error={state.error} />
    </form>
  );
}

function ReceiveGoodsButton({ returnId }: { returnId: string }) {
  const { state, pending, formProps } = useSubmitAction(
    () => receiveReturnAction(returnId),
    { error: null } as FormState
  );
  return (
    <form {...formProps} className="flex items-center gap-3">
      <button type="submit" disabled={pending} className={secondaryButton}>
        {pending ? "Recording…" : "Goods received — update stock"}
      </button>
      <ErrorLine error={state.error} />
    </form>
  );
}

function RequestProviderRefundButton({ returnId }: { returnId: string }) {
  const [state, formAction, pending] = useActionState<RequestProviderRefundState, FormData>(
    async () => requestProviderRefundAction(returnId),
    { error: null }
  );
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={secondaryButton}>
          {pending ? "Requesting…" : "Request Paystack refund"}
        </button>
        {state.paystackStatus && !state.error && (
          <span className="text-sm text-status-success-fg">Requested — Paystack says “{state.paystackStatus}.”</span>
        )}
        <ErrorLine error={state.error} />
      </div>
      <p className="text-xs text-text-muted">
        Only works if this order was paid through Paystack. Paystack accepting the request isn’t
        the same as the money landing — once it has, confirm with “Mark refund as paid” below.
      </p>
    </form>
  );
}

/** The next step(s) available on a return, depending on its state and who is looking. */
function ApproveReturnForm({ returnId, valueNaira }: { returnId: string; valueNaira: number }) {
  const { state, pending, formProps } = useSubmitAction(decideReturnAction.bind(null, returnId, true), {
    error: null,
  } as FormState);
  return (
    <form {...formProps} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        Refund (₦) — leave blank for the full {valueNaira.toLocaleString("en-NG")}
        <input
          name="refundNaira"
          type="number"
          min="1"
          step="any"
          max={valueNaira}
          placeholder={String(valueNaira)}
          className={`${inputClass} w-44`}
        />
      </label>
      <input name="note" type="text" placeholder="Note (required if refunding less)" aria-label="Note" className={`${inputClass} w-64`} />
      <button type="submit" disabled={pending} className={primaryButton}>
        {pending ? "Approving…" : "Approve return"}
      </button>
      <ErrorLine error={state.error} />
    </form>
  );
}

export function ReturnActions({
  returnId,
  status,
  refundStatus,
  isOwner,
  valueNaira,
}: {
  returnId: string;
  status: string;
  refundStatus: string;
  isOwner: boolean;
  valueNaira: number;
}) {
  const nothingForStaff = (what: string) => (
    <p className="text-sm text-text-muted">{what} — only an owner can do this.</p>
  );

  return (
    <div className="flex flex-col gap-3">
      {status === "REQUESTED" &&
        (isOwner ? (
          <div className="flex flex-col gap-3">
            <ApproveReturnForm returnId={returnId} valueNaira={valueNaira} />
            <NoteAction
              action={decideReturnAction.bind(null, returnId, false)}
              label="Reject return"
              pendingLabel="Rejecting…"
              placeholder="Why it's being rejected (optional)"
              variant="danger"
            />
          </div>
        ) : (
          nothingForStaff("Waiting for the owner to approve or reject this return")
        ))}

      {status === "APPROVED" && <ReceiveGoodsButton returnId={returnId} />}

      {refundStatus === "PENDING" &&
        (isOwner ? (
          <div className="flex flex-col gap-2">
            <RequestProviderRefundButton returnId={returnId} />
            <NoteAction
              action={markRefundedAction.bind(null, returnId)}
              label="Mark refund as paid"
              pendingLabel="Saving…"
              placeholder="How it was paid (e.g. bank transfer ref)"
            />
          </div>
        ) : (
          nothingForStaff("This refund is waiting to be paid out")
        ))}
    </div>
  );
}
