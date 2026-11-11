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
import { 
  RotateCcw, 
  CheckCircle2, 
  XCircle, 
  DollarSign, 
  Loader2, 
  PackageCheck, 
  CreditCard, 
  AlertCircle 
} from "lucide-react";

const inputClass =
  "rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink";
const primaryButton =
  "inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-paper transition-colors hover:bg-accent-2 disabled:opacity-60";
const secondaryButton =
  "inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-all hover:bg-paper disabled:opacity-60";
const dangerButton =
  "inline-flex items-center gap-1.5 rounded-md border border-status-attention-fg/30 bg-status-attention-bg px-3.5 py-2 text-sm font-medium text-status-attention-fg transition-all hover:bg-status-attention-fg hover:text-white disabled:opacity-60";

export type ReturnableLine = {
  orderItemId: string;
  label: string;
  sku: string;
  returnable: number;
  unit: string;
};

export function RequestReturnForm({ orderId, lines }: { orderId: string; lines: ReturnableLine[] }) {
  const { state, pending, formProps } = useSubmitAction(
    requestReturnAction.bind(null, orderId), 
    { error: null } as FormState, 
    { resetOnSuccess: true }
  );

  return (
    <form {...formProps} className="card-base p-5 flex flex-col gap-5">
      <div className="flex items-center gap-2 border-b border-line pb-3">
        <RotateCcw className="h-4 w-4 text-ink" />
        <h3 className="text-xs font-semibold text-ink">Initiate customer return</h3>
      </div>

      <div className="overflow-x-auto border border-line">
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
              <th className="py-2.5 px-3">Item</th>
              <th className="py-2.5 px-3 text-right w-32">Returnable</th>
              <th className="py-2.5 px-3 w-32">Qty to return</th>
              <th className="py-2.5 px-3 w-36">Condition</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {lines.map((line) => (
              <tr key={line.orderItemId} className="hover:bg-paper/20">
                <td className="py-3 px-3 text-ink">
                  <div className="font-medium">{line.label}</div>
                  <span className="font-mono text-xs text-text-muted">{line.sku}</span>
                </td>
                <td className="py-3 px-3 text-right font-tabular text-text-muted">
                  {line.returnable} {line.unit}{line.returnable === 1 ? "" : "s"}
                </td>
                <td className="py-3 px-3">
                  <input
                    type="number"
                    name={`qty_${line.orderItemId}`}
                    min={0}
                    max={line.returnable}
                    step={1}
                    disabled={line.returnable === 0}
                    aria-label={`Quantity of ${line.label} to return`}
                    placeholder="0"
                    className={`${inputClass} w-24 font-tabular text-center`}
                  />
                </td>
                <td className="py-3 px-3">
                  <select
                    name={`condition_${line.orderItemId}`}
                    disabled={line.returnable === 0}
                    aria-label={`Condition of ${line.label}`}
                    className={`${inputClass} text-xs`}
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
        <label htmlFor="reason" className="text-xs font-semibold text-ink">
          Reason for return <span className="text-accent">*</span>
        </label>
        <input
          id="reason"
          name="reason"
          type="text"
          required
          placeholder="e.g. Defective zipper, size discrepancy, customer change of mind"
          className={inputClass}
        />
      </div>

      {state.error && (
        <div className="flex items-center gap-2 rounded-md border border-status-attention-fg/30 bg-status-attention-bg p-3 text-xs text-status-attention-fg">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
          <span>{pending ? "Submitting…" : "Request Return"}</span>
        </button>
      </div>
    </form>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <div className="flex items-center gap-1.5 text-xs text-status-attention-fg font-medium mt-1">
      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
      <span>{error}</span>
    </div>
  ) : null;
}

function NoteAction({
  action,
  label,
  pendingLabel,
  placeholder,
  variant = "primary",
  icon: Icon,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  label: string;
  pendingLabel: string;
  placeholder: string;
  variant?: "primary" | "danger" | "secondary";
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const { state, pending, formProps } = useSubmitAction(action, { error: null } as FormState);
  return (
    <form {...formProps} className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <input 
          name="note" 
          type="text" 
          placeholder={placeholder} 
          aria-label={placeholder} 
          className={`${inputClass} flex-1 min-w-[200px] text-xs`} 
        />
        <button
          type="submit"
          disabled={pending}
          className={variant === "primary" ? primaryButton : variant === "danger" ? dangerButton : secondaryButton}
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : Icon ? (
            <Icon className="h-3.5 w-3.5" />
          ) : null}
          <span>{pending ? pendingLabel : label}</span>
        </button>
      </div>
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
    <form {...formProps} className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={secondaryButton}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4 text-emerald-600" />}
          <span>{pending ? "Recording Intake…" : "Goods Received — Update Inventory"}</span>
        </button>
      </div>
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
    <form action={formAction} className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={secondaryButton}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4 text-accent" />}
          <span>{pending ? "Requesting…" : "Automate Paystack Refund"}</span>
        </button>
        {state.paystackStatus && !state.error && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-status-success-fg bg-status-success-bg px-2 py-1 rounded">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Paystack: {state.paystackStatus}
          </span>
        )}
      </div>
      <p className="text-xs text-text-muted">
        Triggers an automated payout via Paystack. Once settlement confirms, record as paid below.
      </p>
      <ErrorLine error={state.error} />
    </form>
  );
}

function ApproveReturnForm({ returnId, valueNaira }: { returnId: string; valueNaira: number }) {
  const { state, pending, formProps } = useSubmitAction(decideReturnAction.bind(null, returnId, true), {
    error: null,
  } as FormState);
  return (
    <form {...formProps} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          <span>Refund (₦) <span className="font-normal">— leave blank for full ₦{valueNaira.toLocaleString("en-NG")}</span></span>
          <input
            name="refundNaira"
            type="number"
            min="1"
            step="any"
            max={valueNaira}
            placeholder={String(valueNaira)}
            className={`${inputClass} w-36 font-tabular text-right`}
          />
        </label>
        <input 
          name="note" 
          type="text" 
          placeholder="Approval note (required if refunding partial amount)" 
          aria-label="Note" 
          className={`${inputClass} flex-1 min-w-[200px] text-xs`} 
        />
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          <span>{pending ? "Approving…" : "Approve Return"}</span>
        </button>
      </div>
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
    <p className="text-xs text-text-muted italic">{what} — requires Owner clearance.</p>
  );

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-paper/40 p-3.5 border border-line">
      {status === "REQUESTED" &&
        (isOwner ? (
          <div className="flex flex-col gap-3">
            <ApproveReturnForm returnId={returnId} valueNaira={valueNaira} />
            <div className="border-t border-line/60 pt-2">
              <NoteAction
                action={decideReturnAction.bind(null, returnId, false)}
                label="Reject Return"
                pendingLabel="Rejecting…"
                placeholder="Reason for return rejection…"
                variant="danger"
                icon={XCircle}
              />
            </div>
          </div>
        ) : (
          nothingForStaff("Awaiting Owner authorization to approve or reject")
        ))}

      {status === "APPROVED" && <ReceiveGoodsButton returnId={returnId} />}

      {refundStatus === "PENDING" &&
        (isOwner ? (
          <div className="flex flex-col gap-3">
            <RequestProviderRefundButton returnId={returnId} />
            <div className="border-t border-line/60 pt-2">
              <NoteAction
                action={markRefundedAction.bind(null, returnId)}
                label="Mark Refund Paid"
                pendingLabel="Recording…"
                placeholder="Payment reference (e.g. Bank transfer ref / receipt)"
                icon={DollarSign}
              />
            </div>
          </div>
        ) : (
          nothingForStaff("Refund liability is pending payout by Owner")
        ))}
    </div>
  );
}
