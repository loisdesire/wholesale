"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createCustomerAction, type FormState } from "../actions";

const inputClass =
  "rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10";

export function NewCustomerForm() {
  const [state, formAction, pending] = useActionState(createCustomerAction, { error: null } as FormState);
  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="text-sm font-medium text-ink">Name</label>
          <input id="name" name="name" type="text" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="phone" className="text-sm font-medium text-ink">Phone</label>
          <input id="phone" name="phone" type="text" required placeholder="0803 123 4567" className={inputClass} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-ink">Email (optional)</label>
        <input id="email" name="email" type="email" className={inputClass} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className="text-sm font-medium text-ink">Notes (optional)</label>
        <textarea id="notes" name="notes" rows={3} className={inputClass} />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-status-attention-fg">
          {state.error}{" "}
          {state.existingId && (
            <Link href={`/customers/${state.existingId}`} className="underline underline-offset-2">
              Open their record
            </Link>
          )}
        </p>
      )}
      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-ink-2 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Add customer"}
        </button>
      </div>
    </form>
  );
}
