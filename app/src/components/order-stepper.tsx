const STEPS = ["DRAFT", "CONFIRMED", "PAID", "FULFILLED"] as const;
const STEP_LABEL: Record<(typeof STEPS)[number], string> = {
  DRAFT: "Draft",
  CONFIRMED: "Confirmed",
  PAID: "Paid",
  FULFILLED: "Fulfilled",
};

export function OrderStepper({ status }: { status: string }) {
  if (status === "CANCELLED") {
    return (
      <div className="inline-flex items-center gap-2 rounded-full bg-status-attention-bg px-3 py-1 text-sm font-semibold text-status-attention-fg">
        <span className="h-2 w-2 rounded-full bg-status-attention-fg" />
        Cancelled
      </div>
    );
  }

  // A part-shipped order is on the last step but not done: show it as such.
  const partly = status === "PARTIALLY_FULFILLED";
  const currentIndex = STEPS.indexOf((partly ? "FULFILLED" : status) as (typeof STEPS)[number]);

  return (
    // Four equal segments that always fit the width (a grid, not a wrapping row), so every step
    // stays visible on a phone. Each segment is a bar + label: filled = done, cobalt = current.
    <ol className="grid w-full max-w-xl grid-cols-4 gap-1.5">
      {STEPS.map((step, i) => {
        // A fully fulfilled order has nothing left "in progress": every step, including the
        // last, is done.
        const complete = status === "FULFILLED";
        const done = i < currentIndex || complete;
        const active = i === currentIndex && !complete;
        return (
          <li key={step} aria-current={active ? "step" : undefined} className="flex min-w-0 flex-col gap-1.5">
            <span
              className={`h-1.5 rounded-full ${
                done ? "bg-status-success-fg" : active ? (partly ? "bg-status-progress-fg" : "bg-accent") : "bg-line"
              }`}
            />
            <span className="flex items-center gap-1 text-xs">
              {done && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0 text-status-success-fg" aria-hidden="true">
                  <path d="M2.5 6.5 5 9l4.5-5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              <span className={`truncate ${active ? "font-semibold text-ink" : done ? "font-medium text-ink" : "text-text-muted"}`}>
                {partly && step === "FULFILLED" ? "Partly shipped" : STEP_LABEL[step]}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
