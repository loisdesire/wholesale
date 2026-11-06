"use client";

import { useState } from "react";
import { useSubmitAction } from "@/lib/use-submit-action";
import { loginAction } from "./actions";
import { Mail, Lock, Eye, EyeOff, ArrowRight, Loader2 } from "lucide-react";

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [showPassword, setShowPassword] = useState(false);
  const { state, pending, formProps } = useSubmitAction(loginAction, {
    error: null,
  });

  return (
    <form {...formProps} className="mt-8 flex flex-col gap-5">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />

      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="text-xs font-semibold uppercase tracking-wider text-ink/80">
          Email address
        </label>
        <div className="relative flex items-center">
          <div className="pointer-events-none absolute left-3.5 text-text-muted">
            <Mail className="h-4 w-4" />
          </div>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="name@company.com"
            required
            className="w-full rounded-xl border border-line bg-paper/30 py-2.5 pl-10 pr-3.5 text-sm text-ink transition-all placeholder:text-text-muted/60 outline-none focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-ink/80">
            Password
          </label>
        </div>
        <div className="relative flex items-center">
          <div className="pointer-events-none absolute left-3.5 text-text-muted">
            <Lock className="h-4 w-4" />
          </div>
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="••••••••••••"
            required
            className="w-full rounded-xl border border-line bg-paper/30 py-2.5 pl-10 pr-10 text-sm text-ink transition-all placeholder:text-text-muted/60 outline-none focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3.5 text-text-muted transition-colors hover:text-ink focus:outline-none"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {state.error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-status-attention-fg/20 bg-status-attention-bg p-3.5 text-xs text-status-attention-fg animate-in fade-in"
        >
          <div className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-status-attention-fg" />
          <span className="leading-relaxed font-medium">{state.error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="group relative mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-md shadow-accent/20 transition-all hover:bg-accent-2 hover:shadow-lg hover:shadow-accent/30 active:scale-[0.99] disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
      >
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-white" />
            <span>Signing in…</span>
          </>
        ) : (
          <>
            <span>Sign in to Dashboard</span>
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </>
        )}
      </button>
    </form>
  );
}
