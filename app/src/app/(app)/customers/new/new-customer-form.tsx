"use client";

import Link from "next/link";

import { useSubmitAction } from "@/lib/use-submit-action";
import { createCustomerAction, type FormState } from "../actions";

const inputClass =
  "input";

export function NewCustomerForm() {
  const { state, pending, formProps } = useSubmitAction(createCustomerAction, { error: null } as FormState);
  return (
    <form {...formProps} className="card flex max-w-xl flex-col gap-4 p-5 sm:p-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="field-label">Name</label>
          <input id="name" name="name" type="text" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="phone" className="field-label">Phone</label>
          <input id="phone" name="phone" type="text" required placeholder="0803 123 4567" className={inputClass} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="field-label">Email (optional)</label>
        <input id="email" name="email" type="email" className={inputClass} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className="field-label">Notes (optional)</label>
        <textarea id="notes" name="notes" rows={3} className={inputClass} />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-status-attention-fg">
          {state.error}{" "}
          {state.existingId && (
            <Link href={`/customers/${state.existingId}`} className="link">
              Open their record
            </Link>
          )}
        </p>
      )}
      <div>
        <button
          type="submit"
          disabled={pending}
          className="btn btn-primary"
        >
          {pending ? "Saving…" : "Add customer"}
        </button>
      </div>
    </form>
  );
}
