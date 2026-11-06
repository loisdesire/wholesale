"use client";

import Link from "next/link";
import { useSubmitAction } from "@/lib/use-submit-action";
import { createCustomerAction, type FormState } from "../actions";
import { UserPlus, Loader2, AlertCircle, ArrowRight } from "lucide-react";

export function NewCustomerForm() {
  const { state, pending, formProps } = useSubmitAction(createCustomerAction, { error: null } as FormState);

  return (
    <form {...formProps} className="card-base p-6 flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="text-xs font-semibold uppercase tracking-wider text-ink">
            Customer or Business Name
          </label>
          <input 
            id="name" 
            name="name" 
            type="text" 
            placeholder="e.g. Blessing Nwachukwu" 
            className="rounded-md border border-line bg-surface px-3 py-2 text-base sm:text-sm text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink" 
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="phone" className="text-xs font-semibold uppercase tracking-wider text-ink">
            WhatsApp Phone Number <span className="text-accent">*</span>
          </label>
          <input 
            id="phone" 
            name="phone" 
            type="text" 
            required 
            placeholder="e.g. 0803 123 4567" 
            className="rounded-md border border-line bg-surface px-3 py-2 text-base sm:text-sm text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink" 
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-xs font-semibold uppercase tracking-wider text-ink">
          Email Address <span className="text-text-muted font-normal lowercase">(optional)</span>
        </label>
        <input 
          id="email" 
          name="email" 
          type="email" 
          placeholder="e.g. blessing@example.com" 
          className="rounded-md border border-line bg-surface px-3 py-2 text-base sm:text-sm text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink" 
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className="text-xs font-semibold uppercase tracking-wider text-ink">
          Wholesale Profile &amp; Preferences <span className="text-text-muted font-normal lowercase">(optional)</span>
        </label>
        <textarea 
          id="notes" 
          name="notes" 
          rows={3} 
          placeholder="Wholesale bulk preferences, boutique location, preferred delivery driver, bank transfer habits…" 
          className="rounded-md border border-line bg-surface px-3 py-2 text-base sm:text-sm text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink" 
        />
      </div>

      {state.error && (
        <div className="flex items-start gap-2.5 rounded-md border border-status-attention-fg/30 bg-status-attention-bg p-3 text-xs text-status-attention-fg">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1">
            <span>{state.error}</span>
            {state.existingId && (
              <Link 
                href={`/customers/${state.existingId}`} 
                className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:text-ink transition-colors"
              >
                <span>Open their existing customer record</span>
                <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-end border-t border-line pt-4">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-accent-2 active:scale-95 disabled:opacity-60 shadow-sm cursor-pointer"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          <span>{pending ? "Creating Customer…" : "Add Customer"}</span>
        </button>
      </div>
    </form>
  );
}
