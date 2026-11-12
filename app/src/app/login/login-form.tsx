"use client";


import { useSubmitAction } from "@/lib/use-submit-action";
import { loginAction } from "./actions";

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const { state, pending, formProps } = useSubmitAction(loginAction, {
    error: null,
  });

  return (
    <form {...formProps} className="flex flex-col gap-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="field-label">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="input"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="field-label">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
        />
      </div>

      {state.error && (
        <p role="alert" className="rounded-lg bg-status-attention-bg px-3 py-2 text-sm font-medium text-status-attention-fg">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary btn-lg mt-2 w-full"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
