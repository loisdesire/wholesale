import type { Metadata } from "next";
import { OrderStatus } from "@prisma/client";
import { getTrackingView } from "@/lib/order-tracking";
import { formatDateTime } from "@/lib/format";

// Customer-facing and reached by a private link: never cache, never index.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Your order",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Step = { label: string; done: boolean };

function stepsFor(status: OrderStatus, isPaid: boolean): Step[] {
  const shipped = status === OrderStatus.PARTIALLY_FULFILLED || status === OrderStatus.FULFILLED;
  return [
    { label: "Order confirmed", done: status !== OrderStatus.DRAFT },
    { label: "Payment received", done: isPaid },
    { label: status === OrderStatus.PARTIALLY_FULFILLED ? "Part shipped" : "Shipped", done: shipped },
  ];
}

export default async function TrackPage({ params }: PageProps<"/track/[org]/[token]">) {
  const { org, token } = await params;
  const view = await getTrackingView(org, token);

  if (!view) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-3 px-4 py-10">
        <h1 className="page-title">We can’t find that order</h1>
        <p className="text-sm text-text-muted">The link may be incomplete. Ask the business to send it again.</p>
      </main>
    );
  }

  const cancelled = view.status === OrderStatus.CANCELLED;
  const steps = stepsFor(view.status, view.isPaid);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-5 px-4 py-8">
      <header>
        <p className="eyebrow">{view.businessName}</p>
        <h1 className="page-title mt-1">Order {view.reference}</h1>
        <p className="mt-1 text-sm text-text-muted">Placed {formatDateTime(view.createdAt)}</p>
      </header>

      {cancelled ? (
        <section className="card p-4">
          <p className="font-semibold">This order was cancelled.</p>
          <p className="mt-1 text-sm text-text-muted">Please contact {view.businessName} if you have a question.</p>
        </section>
      ) : (
        <ol className="card flex flex-col gap-3 p-4" aria-label="Order progress">
          {steps.map((s) => (
            <li key={s.label} className="flex items-center gap-3">
              <span
                aria-hidden
                className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold ${s.done ? "bg-accent text-white" : "border border-line text-text-muted"}`}
              >
                {s.done ? "✓" : ""}
              </span>
              <span className={s.done ? "font-semibold" : "text-text-muted"}>{s.label}</span>
            </li>
          ))}
        </ol>
      )}

      <section className="card p-4">
        <h2 className="section-title">Items</h2>
        <ul className="mt-2 flex flex-col divide-y divide-line">
          {view.items.map((i, n) => (
            <li key={n} className="flex items-baseline justify-between gap-3 py-2">
              <span>
                {i.name}
                {i.variantLabel ? <span className="text-text-muted"> · {i.variantLabel}</span> : null}
              </span>
              <span className="font-tabular shrink-0 text-sm text-text-muted">
                {i.shipped > 0 ? `${i.shipped} of ${i.quantity} shipped` : `× ${i.quantity}`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {view.shipments.length > 0 ? (
        <section className="card p-4">
          <h2 className="section-title">Shipments</h2>
          <ul className="mt-2 flex flex-col divide-y divide-line">
            {view.shipments.map((s) => (
              <li key={s.reference} className="py-2">
                <p className="font-semibold">
                  {s.units} item{s.units === 1 ? "" : "s"} · {formatDateTime(s.shippedAt)}
                </p>
                {s.carrier || s.trackingReference ? (
                  <p className="text-sm text-text-muted">
                    {[s.carrier, s.trackingReference ? `Tracking ${s.trackingReference}` : null].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-xs text-text-muted">Questions? Reply to the business in the same chat.</p>
    </main>
  );
}
