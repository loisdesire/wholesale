import Link from "next/link";
import { Check } from "lucide-react";

/**
 * Shown on the dashboard of a business that has no orders or chats yet. A new owner should see
 * what to do next, not "All caught up".
 */
export function GettingStarted({ productCount, isOwner, channelConnected }: { productCount: number; isOwner: boolean; channelConnected: boolean }) {
  const steps = [
    {
      done: productCount > 0,
      title: "Add your products",
      body: "The AI can only quote what is in your catalogue.",
      href: "/catalogue/new",
      cta: productCount > 0 ? "Add more" : "Add a product",
    },
    {
      done: channelConnected,
      title: "Connect WhatsApp or Telegram",
      body: channelConnected ? "Connected. New messages land in your inbox." : isOwner ? "Add your channel details to the server settings, then message your number to test." : "Ask the owner to connect a channel.",
      href: "/inbox",
      cta: "Open inbox",
    },
    {
      done: false,
      title: "Create your first order",
      body: "You can start by hand while a channel is being connected.",
      href: "/orders/new",
      cta: "New order",
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="getting-started-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="getting-started-title" className="section-title">
          Get started
        </h2>
        <span className="text-xs text-text-muted">
          {doneCount} of {steps.length} done
        </span>
      </div>
      <ol className="mt-3 flex flex-col divide-y divide-line">
        {steps.map((s, i) => (
          <li key={s.title} className="flex items-start gap-3 py-3">
            <span
              aria-hidden
              className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold ${s.done ? "bg-accent text-white" : "border border-line text-text-muted"}`}
            >
              {s.done ? <Check size={14} strokeWidth={3} /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{s.title}</p>
              <p className="mt-0.5 text-sm text-text-muted">{s.body}</p>
            </div>
            <Link href={s.href} className="btn btn-secondary btn-sm shrink-0">
              {s.cta}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
