"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";

/**
 * Like `useActionState`, but without React 19's automatic form reset.
 *
 * With `<form action={fn}>` React clears every uncontrolled input as soon as the
 * action finishes — even when the server refused it. A person who typed a
 * refund amount and got "say why it's reduced" would find their amount gone, and
 * their retry would silently submit a blank (a full refund, in that case). This
 * hook submits through `onSubmit` so a failed attempt keeps what was typed, and
 * can clear the form only once an attempt succeeds.
 */
export type SubmitState = { error: string | null; existingId?: string; saved?: boolean };

export function useSubmitAction(
  action: (previous: SubmitState, formData: FormData) => Promise<SubmitState>,
  initial: SubmitState,
  options: { resetOnSuccess?: boolean } = {}
) {
  const [state, run, pending] = useActionState<SubmitState, FormData>(action, initial);
  const ref = useRef<HTMLFormElement>(null);
  const initialRef = useRef(initial);

  useEffect(() => {
    if (options.resetOnSuccess && state !== initialRef.current && state.error === null) ref.current?.reset();
  }, [state, options.resetOnSuccess]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => run(formData));
  };

  return { state, pending, formProps: { ref, onSubmit } };
}
