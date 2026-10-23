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

  const currentIndex = STEPS.indexOf(status as (typeof STEPS)[number]);

  return (
    <ol className="flex items-center gap-2">
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
                {STEP_LABEL[step]}
              </span>
            </div>
            {i < STEPS.length - 1 && <span className="h-px w-6 bg-line" />}
          </li>
        );
      })}
    </ol>
  );
}
