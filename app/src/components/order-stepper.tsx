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
      <div className="flex items-center gap-2 text-sm text-status-attention-fg">
        <span className="h-2 w-2 rounded-full bg-status-attention-fg" />
        Cancelled
      </div>
    );
  }

  // A part-shipped order is on the last step but not done: show it as such.
  const partly = status === "PARTIALLY_FULFILLED";
  const currentIndex = STEPS.indexOf((partly ? "FULFILLED" : status) as (typeof STEPS)[number]);

  return (
    // flex-wrap, not a fixed single row: on a narrow screen the 4th step was being clipped off
    // the right edge entirely, with no way to see it — wrapping onto a second line keeps every
    // step visible without needing horizontal scroll for something this short.
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {STEPS.map((step, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        return (
          <li key={step} className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-medium ${
                  done
                    ? "bg-status-success-fg text-paper"
                    : active
                      ? "bg-ink text-paper"
                      : "border border-line text-text-muted"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className={`text-sm ${active ? "font-medium text-ink" : "text-text-muted"}`}>
                {partly && step === "FULFILLED" ? "Partly shipped" : STEP_LABEL[step]}
              </span>
            </div>
            {i < STEPS.length - 1 && <span className="h-px w-6 bg-line" />}
          </li>
        );
      })}
    </ol>
  );
}
