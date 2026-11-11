import { Check, AlertCircle } from "lucide-react";

const STEPS = ["DRAFT", "CONFIRMED", "PAID", "FULFILLED"] as const;
const STEP_LABEL: Record<(typeof STEPS)[number], string> = {
  DRAFT: "Draft",
  CONFIRMED: "Confirmed",
  PAID: "Settled",
  FULFILLED: "Fulfilled",
};

export function OrderStepper({ status }: { status: string }) {
  if (status === "CANCELLED") {
    return (
      <div className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-1.5 text-xs font-semibold text-rose-800">
        <AlertCircle className="h-3.5 w-3.5 text-rose-700" />
        <span>Order Cancelled</span>
      </div>
    );
  }

  const partly = status === "PARTIALLY_FULFILLED";
  const currentIndex = STEPS.indexOf((partly ? "FULFILLED" : status) as (typeof STEPS)[number]);

  return (
    <nav aria-label="Order lifecycle progress" className="inline-flex flex-wrap items-center gap-1.5 sm:gap-2">
      {STEPS.map((step, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        const isLast = i === STEPS.length - 1;

        return (
          <div key={step} className="flex items-center gap-1.5 sm:gap-2">
            <div
              className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                done
                  ? "bg-emerald-500/10 text-emerald-800 border border-emerald-500/20"
                  : active
                    ? "bg-accent text-white shadow-xs shadow-accent/20"
                    : "bg-surface/60 text-text-muted border border-line/60"
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
                  done
                    ? "bg-emerald-600 text-white"
                    : active
                      ? "bg-white text-accent"
                      : "bg-paper text-ink/70"
                }`}
              >
                {done ? <Check className="h-3 w-3 stroke-[3]" /> : i + 1}
              </span>
              <span className="tracking-tight">
                {partly && step === "FULFILLED" ? "Partly Shipped" : STEP_LABEL[step]}
              </span>
            </div>

            {!isLast && (
              <span
                className={`h-0.5 w-3 rounded-full transition-colors ${
                  i < currentIndex ? "bg-emerald-500/40" : "bg-line/70"
                }`}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
