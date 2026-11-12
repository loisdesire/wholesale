import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  CheckCheck,
  Lock,
  MessageCircle,
  Package,
  ReceiptText,
  Sparkles,
  Truck,
  Undo2,
  Users,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { Avatar } from "@/components/avatar";

/**
 * Public marketing page (served at "/" to signed-out visitors — see src/proxy.ts).
 *
 * Every visual here is built from the product's own UI vocabulary (chat bubbles, order tickets,
 * the stepper, stock bars) rather than stock art, and every claim maps to something the app
 * actually does. No testimonials, customer logos, statistics or prices are shown because none
 * are real yet — add them only when they are.
 */
export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <SiteHeader />
      <main>
        <Hero />
        <LifecycleTicker />
        <HowItWorks />
        <Features />
        <Principles />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}

/* ── Header ──────────────────────────────────────────────────────────────── */

function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/85 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5">
        <Link href="/" aria-label="Adaeze Wholesale home">
          <Logo />
        </Link>
        <nav aria-label="Page sections" className="hidden items-center gap-8 text-sm font-medium text-text-muted md:flex">
          <a href="#how" className="transition-colors hover:text-ink">
            How it works
          </a>
          <a href="#features" className="transition-colors hover:text-ink">
            What&apos;s inside
          </a>
          <a href="#principles" className="transition-colors hover:text-ink">
            Why trust it
          </a>
        </nav>
        <Link href="/login" className="btn btn-dark">
          Sign in
        </Link>
      </div>
    </header>
  );
}

/* ── Hero ────────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 pb-10 pt-12 md:pt-20">
      <div className="anim-rise max-w-4xl">
        <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-text-muted shadow-card">
          <span className="h-2 w-2 rounded-full bg-wa" />
          Order operations for WhatsApp wholesalers
        </p>
        <h1 className="mt-6 font-display text-[44px] font-extrabold leading-[0.98] tracking-[-0.035em] sm:text-7xl lg:text-[88px]">
          Chats come in.
          <br />
          <span className="relative whitespace-nowrap">
            <span className="relative z-10">Orders go out.</span>
            <span aria-hidden="true" className="absolute inset-x-[-0.08em] bottom-[0.06em] z-0 h-[0.34em] rounded-md bg-gold" />
          </span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-text-muted md:text-xl">
          Adaeze turns every WhatsApp enquiry into a tracked order — with a status, an owner and a
          record of what happened — so nothing gets lost between &ldquo;how much?&rdquo; and
          &ldquo;delivered&rdquo;.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/login" className="btn btn-primary btn-lg">
            Sign in to your workspace
            <ArrowRight size={17} />
          </Link>
          <a href="#how" className="btn btn-secondary btn-lg">
            See how it works
          </a>
        </div>
      </div>

      <HeroScene />
    </section>
  );
}

/** The product story in one picture: a chat on the left becomes an order on the right. */
function HeroScene() {
  return (
    <div
      className="anim-rise relative mt-12 overflow-hidden rounded-[28px] bg-accent p-4 sm:p-8 lg:p-12"
      style={{ animationDelay: "0.15s" }}
    >
      {/* Dot grid: a quiet texture that says "workspace" without a gradient blob. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-25"
        style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, rgb(255 255 255 / 0.9) 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />
      <div className="relative grid items-center gap-5 lg:grid-cols-[1fr_auto_1.1fr] lg:gap-6">
        <ChatCard />

        <div className="flex items-center justify-center lg:flex-col">
          <span className="hidden h-12 w-px bg-white/40 lg:block" />
          <span className="flex items-center gap-2 rounded-full bg-gold px-3.5 py-2 text-xs font-bold text-gold-ink shadow-pop">
            <Sparkles size={14} />
            Becomes an order
          </span>
          <span className="hidden h-12 w-px bg-white/40 lg:block" />
        </div>

        <div className="relative">
          <OrderTicket />
          <div
            className="anim-pop absolute -bottom-5 -left-3 hidden items-center gap-2.5 rounded-2xl bg-surface px-4 py-3 shadow-pop sm:flex lg:-left-10"
            style={{ animationDelay: "0.9s" }}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-status-success-bg text-status-success-fg">
              <BadgeCheck size={17} />
            </span>
            <div className="text-sm leading-tight">
              <p className="font-semibold">Payment verified</p>
              <p className="font-tabular text-xs text-text-muted">₦222,000 · Paystack</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatCard() {
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-pop sm:p-5">
      <div className="flex items-center gap-3 border-b border-line pb-3">
        <Avatar name="Blessing Nwachukwu" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">Blessing Nwachukwu</p>
          <p className="flex items-center gap-1.5 text-xs text-text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-wa" /> WhatsApp
          </p>
        </div>
        <span className="rounded-full bg-status-attention-bg px-2 py-0.5 text-xs font-semibold text-status-attention-fg">
          Awaiting staff
        </span>
      </div>
      <div className="flex flex-col gap-2.5 pt-4 text-sm">
        <Bubble side="in" delay={0.3}>
          Good morning. Do you still have the Ankara two-piece in red? I need 12 in size M.
        </Bubble>
        <Bubble side="out" delay={0.55} label="Drafted by AI assist · sent by Chidinma">
          We do — 15 in stock. 12 × ₦18,500 comes to ₦222,000. Shall I confirm it for you?
        </Bubble>
        <Bubble side="in" delay={0.8}>
          Yes please, confirm.
        </Bubble>
      </div>
    </div>
  );
}

function Bubble({ side, children, label, delay }: { side: "in" | "out"; children: ReactNode; label?: string; delay?: number }) {
  return (
    <div className={`anim-pop flex ${side === "in" ? "justify-start" : "justify-end"}`} style={{ animationDelay: `${delay ?? 0}s` }}>
      <div
        className={`max-w-[85%] px-3.5 py-2.5 leading-snug ${
          side === "in" ? "rounded-2xl rounded-bl-md bg-paper text-ink" : "rounded-2xl rounded-br-md bg-ink text-white"
        }`}
      >
        {label && <p className="mb-1 text-[11px] font-semibold text-gold">{label}</p>}
        {children}
      </div>
    </div>
  );
}

function OrderTicket() {
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-pop sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-text-muted">ORD-1004</p>
          <p className="mt-0.5 font-display text-3xl font-bold tracking-tight">₦222,000</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-status-progress-bg px-2 py-0.5 text-xs font-semibold text-status-progress-fg">
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          Confirmed
        </span>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-1.5">
        {["Draft", "Confirmed", "Paid", "Fulfilled"].map((s, i) => (
          <div key={s} className="flex flex-col gap-1.5">
            <span className={`h-1.5 rounded-full ${i === 0 ? "bg-status-success-fg" : i === 1 ? "bg-accent" : "bg-line"}`} />
            <span className={`text-xs ${i === 1 ? "font-semibold text-ink" : "text-text-muted"}`}>{s}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-line">
        <div className="flex items-center justify-between gap-3 px-3.5 py-3 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium">Ankara Two-Piece Set</p>
            <p className="text-xs text-text-muted">Red / M · 12 × ₦18,500</p>
          </div>
          <p className="font-tabular font-semibold">₦222,000</p>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line bg-paper/60 px-3.5 py-2.5 text-xs">
          <span className="text-text-muted">Stock reserved</span>
          <span className="flex items-center gap-2 font-semibold">
            <span className="flex h-1.5 w-20 overflow-hidden rounded-full bg-line">
              <span className="w-4/5 bg-accent" />
            </span>
            12 of 15
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-text-muted">
        <span className="flex items-center gap-2">
          <Avatar name="Chidinma Okafor" size="xs" />
          Assigned to Chidinma
        </span>
        <span>Confirmed 09:42</span>
      </div>
    </div>
  );
}

/* ── Lifecycle ticker ────────────────────────────────────────────────────── */

function LifecycleTicker() {
  const stages = ["Enquiry", "Draft", "Confirmed", "Stock reserved", "Paid", "Packed", "Shipped", "Delivered", "Returned, if it must"];
  const row = (hidden: boolean) => (
    <div className="flex shrink-0 items-center" aria-hidden={hidden}>
      {stages.map((s) => (
        <span key={s} className="flex items-center gap-6 pr-6 font-display text-2xl font-bold tracking-tight sm:text-3xl">
          {s}
          <ArrowRight size={22} className="text-gold" />
        </span>
      ))}
    </div>
  );
  return (
    <section aria-label="An order's lifecycle" className="overflow-hidden bg-ink py-5 text-white">
      <div className="anim-marquee flex w-max">
        {row(false)}
        {row(true)}
      </div>
    </section>
  );
}

/* ── How it works ────────────────────────────────────────────────────────── */

function HowItWorks() {
  return (
    <section id="how" className="mx-auto w-full max-w-6xl scroll-mt-20 px-5 py-20 md:py-28">
      <SectionHeading
        eyebrow="How it works"
        title="From “how much?” to “delivered”, in one thread"
        body="The conversation, the order, the stock and the money stay attached to each other — so anyone on your team can pick up where someone else left off."
      />
      <ol className="mt-12 grid gap-5 lg:grid-cols-3">
        <Step
          n={1}
          title="A customer messages you"
          body="WhatsApp messages and photos land in a shared inbox, matched to the customer by phone number — no more hunting through one person's phone."
        >
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center gap-2 text-xs font-semibold text-text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-wa" /> New on WhatsApp
            </div>
            <div className="max-w-[90%] rounded-2xl rounded-bl-md bg-paper px-3.5 py-2.5">
              How much are the heels and the sneakers?
            </div>
            <div className="max-w-[90%] rounded-2xl rounded-bl-md bg-paper px-3.5 py-2.5">I want 6 pairs each.</div>
          </div>
        </Step>
        <Step
          n={2}
          title="It becomes a draft order"
          body="AI assist matches the request to your catalogue and drafts the order at your prices. It asks instead of guessing — and a person always confirms."
        >
          <div className="flex flex-col gap-2 text-sm">
            {[
              ["Strappy Block Heel", "6 × ₦22,000"],
              ["Chunky Sole Sneaker", "6 × ₦26,500"],
            ].map(([name, calc]) => (
              <div key={name} className="flex items-center justify-between rounded-xl border border-line px-3 py-2">
                <span className="font-medium">{name}</span>
                <span className="font-tabular text-xs text-text-muted">{calc}</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-1 pt-1">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-status-neutral-bg px-2 py-0.5 text-xs font-semibold text-status-neutral-fg">
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                Draft
              </span>
              <span className="font-tabular font-semibold">₦291,000</span>
            </div>
          </div>
        </Step>
        <Step
          n={3}
          title="Confirm, get paid, ship"
          body="Confirming reserves the stock. Payment is verified, not assumed. Ship all at once or in parts — every step leaves a record."
        >
          <ul className="flex flex-col gap-2 text-sm">
            {[
              [<Lock key="i" size={15} />, "Stock reserved", "12 pairs held"],
              [<BadgeCheck key="i" size={15} />, "Payment verified", "₦291,000"],
              [<Truck key="i" size={15} />, "Shipped", "2 of 2 parcels"],
            ].map(([icon, label, meta], i) => (
              <li key={i} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-status-success-bg text-status-success-fg">{icon}</span>
                <span className="flex-1 font-medium">{label}</span>
                <span className="font-tabular text-xs text-text-muted">{meta}</span>
              </li>
            ))}
          </ul>
        </Step>
      </ol>
    </section>
  );
}

function Step({ n, title, body, children }: { n: number; title: string; body: string; children: ReactNode }) {
  return (
    <li className="flex flex-col rounded-3xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <div className="min-h-[168px] rounded-2xl bg-paper/70 p-4">
        <div className="rounded-xl bg-surface p-3.5 shadow-card">{children}</div>
      </div>
      <div className="mt-6 flex items-start gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink font-display text-lg font-bold text-gold">
          {n}
        </span>
        <div>
          <h3 className="font-display text-xl font-bold tracking-tight">{title}</h3>
          <p className="mt-1.5 text-[15px] leading-relaxed text-text-muted">{body}</p>
        </div>
      </div>
    </li>
  );
}

function SectionHeading({ eyebrow, title, body, tone = "dark" }: { eyebrow: string; title: string; body?: string; tone?: "dark" | "light" }) {
  return (
    <div className="max-w-3xl">
      <p className={`text-xs font-bold uppercase tracking-[0.14em] ${tone === "light" ? "text-gold" : "text-accent"}`}>{eyebrow}</p>
      <h2 className="mt-3 font-display text-4xl font-extrabold leading-[1.04] tracking-[-0.03em] sm:text-5xl">{title}</h2>
      {body && <p className={`mt-4 text-lg leading-relaxed ${tone === "light" ? "text-white/65" : "text-text-muted"}`}>{body}</p>}
    </div>
  );
}

/* ── Features (bento) ────────────────────────────────────────────────────── */

function Features() {
  return (
    <section id="features" className="scroll-mt-20 border-y border-line bg-surface">
      <div className="mx-auto w-full max-w-6xl px-5 py-20 md:py-28">
        <SectionHeading
          eyebrow="What's inside"
          title="Everything the order touches, in one place"
          body="Six parts of the business that usually live in six different notebooks, chats and spreadsheets."
        />

        <div className="mt-12 grid gap-4 md:grid-cols-6">
          {/* Inbox — wide */}
          <Tile className="md:col-span-4" icon={<MessageCircle size={18} />} title="A shared inbox" body="Every conversation has a status and an owner. Photos come through too, and you can see when a reply was delivered and read.">
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                ["Funmilayo Adebayo", "Ok let me know, I'll take the 4 for now", "Awaiting staff", "attention"],
                ["Chioma Okonkwo", "Do you sell the tote bags wholesale?", "New", "neutral"],
                ["Blessing Nwachukwu", "Yes please, confirm.", "AI handling", "progress"],
                ["Ngozi Eze", "Received, thank you!", "Resolved", "success"],
              ].map(([name, msg, status, tone]) => (
                <div key={name} className="flex items-start gap-3 rounded-xl border border-line bg-surface p-3">
                  <Avatar name={name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{name}</p>
                    <p className="truncate text-xs text-text-muted">{msg}</p>
                    <span className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[tone]}`}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      {status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Tile>

          {/* Stock — ink tile */}
          <Tile className="md:col-span-2" tone="ink" icon={<Package size={18} />} title="Stock you can promise" body="Available is what's on the shelf minus what's reserved and what's damaged. That's the only number customers are promised.">
            <div className="rounded-xl bg-white/[0.07] p-4">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs text-white/55">Available</p>
                  <p className="font-display text-4xl font-bold text-gold">14</p>
                </div>
                <p className="text-xs text-white/55">of 30 on the shelf</p>
              </div>
              <div className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
                <span className="bg-gold" style={{ flexGrow: 14 }} />
                <span className="bg-[#7c8cf8]" style={{ flexGrow: 12 }} />
                <span className="bg-[#f2766b]" style={{ flexGrow: 4 }} />
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/70">
                <Legend color="bg-gold" label="Available 14" />
                <Legend color="bg-[#7c8cf8]" label="Reserved 12" />
                <Legend color="bg-[#f2766b]" label="Damaged 4" />
              </div>
            </div>
          </Tile>

          {/* Orders */}
          <Tile className="md:col-span-2" icon={<ReceiptText size={18} />} title="Orders with a status" body="Draft, confirmed, paid, shipped. Amend before payment, ship in parts, and see who did what.">
            <div className="flex flex-col gap-2">
              {[
                ["ORD-1002", "₦170,000", "Draft", "neutral"],
                ["ORD-1003", "₦159,000", "Confirmed", "progress"],
                ["ORD-1001", "₦277,500", "Fulfilled", "success"],
              ].map(([ref, total, status, tone]) => (
                <div key={ref} className="flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-2.5 text-sm">
                  <span className="font-mono text-xs">{ref}</span>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[tone]}`}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {status}
                  </span>
                  <span className="font-tabular font-semibold">{total}</span>
                </div>
              ))}
            </div>
          </Tile>

          {/* Payments — citron tile */}
          <Tile className="md:col-span-2" tone="gold" icon={<BadgeCheck size={18} />} title="Payments with proof" body="An order is paid when the money is verified — by Paystack, or by a person confirming a transfer arrived. Never on a customer's say-so.">
            <div className="rounded-xl bg-ink p-4 text-white">
              <p className="text-xs text-white/55">Paid so far</p>
              <p className="mt-0.5 font-display text-3xl font-bold">
                ₦100,000 <span className="text-base font-medium text-white/50">of ₦159,000</span>
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/15">
                <div className="h-full w-[63%] rounded-full bg-gold" />
              </div>
              <p className="mt-2 text-xs text-white/60">Part-payments add up. ₦59,000 still to come.</p>
            </div>
          </Tile>

          {/* Customers */}
          <Tile className="md:col-span-2" icon={<Users size={18} />} title="Customers, remembered" body="Agreed prices per customer, what they owe, what you owe them — and duplicates flagged, never merged behind your back.">
            <div className="rounded-xl border border-line bg-surface p-3.5">
              <div className="flex items-center gap-3">
                <Avatar name="Ngozi Eze" />
                <div>
                  <p className="text-sm font-semibold">Ngozi Eze</p>
                  <p className="text-xs text-text-muted">7 orders · agreed prices on 3 products</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-paper px-3 py-2">
                  <p className="text-text-muted">Owes you</p>
                  <p className="font-tabular text-base font-semibold">₦159,000</p>
                </div>
                <div className="rounded-lg bg-paper px-3 py-2">
                  <p className="text-text-muted">You owe</p>
                  <p className="font-tabular text-base font-semibold text-status-attention-fg">₦37,000</p>
                </div>
              </div>
            </div>
          </Tile>

          {/* Reports — wide */}
          <Tile className="md:col-span-4" icon={<CheckCheck size={18} />} title="Reports that don't flatter" body="Revenue, cash received and what's owed are kept separate. Margin only appears where you've recorded costs — and it tells you how much of your sales it covers.">
            <div className="flex items-end gap-2 rounded-xl border border-line bg-surface p-4 sm:gap-3">
              {[38, 52, 44, 67, 58, 80, 72, 91, 64, 86, 100, 78].map((h, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                  <div className="flex h-28 w-full items-end">
                    <div className={`w-full rounded-t-md ${i === 10 ? "bg-accent" : "bg-accent/20"}`} style={{ height: `${h}%` }} />
                  </div>
                  <span className="text-[10px] text-text-muted">{"JFMAMJJASOND"[i]}</span>
                </div>
              ))}
            </div>
          </Tile>

          {/* Returns */}
          <Tile className="md:col-span-2" icon={<Undo2 size={18} />} title="Returns done properly" body="Refunds need an owner's approval. Goods coming back are booked in as resellable or damaged — so the shelf count stays true.">
            <ul className="flex flex-col gap-2 text-sm">
              {["Requested by customer", "Approved by owner", "Goods received", "Refund paid"].map((s, i) => (
                <li key={s} className="flex items-center gap-2.5">
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full ${i < 3 ? "bg-status-success-fg text-white" : "border border-line-strong text-transparent"}`}>
                    <Check size={12} strokeWidth={3} />
                  </span>
                  <span className={i < 3 ? "font-medium" : "text-text-muted"}>{s}</span>
                </li>
              ))}
            </ul>
          </Tile>
        </div>
      </div>
    </section>
  );
}

const TONE: Record<string, string> = {
  neutral: "bg-status-neutral-bg text-status-neutral-fg",
  progress: "bg-status-progress-bg text-status-progress-fg",
  success: "bg-status-success-bg text-status-success-fg",
  attention: "bg-status-attention-bg text-status-attention-fg",
};

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function Tile({
  className = "",
  tone = "light",
  icon,
  title,
  body,
  children,
}: {
  className?: string;
  tone?: "light" | "ink" | "gold";
  icon: ReactNode;
  title: string;
  body: string;
  children: ReactNode;
}) {
  const surface =
    tone === "ink" ? "bg-ink text-white" : tone === "gold" ? "bg-gold text-gold-ink" : "bg-paper text-ink";
  const bodyColor = tone === "ink" ? "text-white/65" : tone === "gold" ? "text-gold-ink/75" : "text-text-muted";
  const iconColor = tone === "ink" ? "bg-white/10 text-gold" : tone === "gold" ? "bg-ink text-gold" : "bg-ink text-white";
  return (
    <article className={`flex flex-col gap-5 rounded-3xl p-5 sm:p-6 ${surface} ${className}`}>
      <div>
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${iconColor}`}>{icon}</span>
        <h3 className="mt-4 font-display text-2xl font-bold tracking-tight">{title}</h3>
        <p className={`mt-1.5 max-w-xl text-[15px] leading-relaxed ${bodyColor}`}>{body}</p>
      </div>
      <div className="mt-auto">{children}</div>
    </article>
  );
}

/* ── Principles ──────────────────────────────────────────────────────────── */

function Principles() {
  const items = [
    ["Stock is a ledger", "There's no number to quietly edit. Every unit in or out is a recorded movement with a reason and a name."],
    ["A payment needs evidence", "Nothing is marked paid on a promise. It's a verified provider payment or a person confirming the cash arrived."],
    ["Agreed prices stay agreed", "An order's prices lock when it's made. Changing your price list tomorrow never rewrites yesterday's deal."],
    ["Every change has a name", "Confirmations, amendments, refunds and reassignments are logged — who, what and when."],
    ["Your data stays yours", "Each business's records are isolated at the database level, not just hidden in the interface."],
    ["People stay in charge", "AI drafts and suggests. Confirming an order, approving a refund or merging customers is always a human decision."],
  ];
  return (
    <section id="principles" className="scroll-mt-20 bg-ink text-white">
      <div className="mx-auto w-full max-w-6xl px-5 py-20 md:py-28">
        <SectionHeading
          tone="light"
          eyebrow="Why trust it"
          title="Built so the numbers can be believed"
          body="Wholesale runs on trust — between you and your customers, and between you and your own records. These rules are built into how the system works, not left to habit."
        />
        <div className="mt-12 grid gap-px overflow-hidden rounded-3xl bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(([title, body], i) => (
            <div key={title} className="bg-ink p-6 sm:p-7">
              <p className="font-tabular text-sm font-semibold text-gold">{String(i + 1).padStart(2, "0")}</p>
              <h3 className="mt-3 font-display text-xl font-bold tracking-tight">{title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-white/65">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Final CTA + footer ──────────────────────────────────────────────────── */

function FinalCta() {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-16 md:py-24">
      <div className="relative overflow-hidden rounded-[28px] bg-gold px-6 py-14 text-gold-ink sm:px-12 md:py-20">
        <h2 className="max-w-3xl font-display text-4xl font-extrabold leading-[1.02] tracking-[-0.03em] sm:text-6xl">
          Stop scrolling chats to find an order.
        </h2>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-gold-ink/75">
          Your enquiries, orders, stock and payments are already connected. Pick up where the team left off.
        </p>
        <div className="mt-8">
          <Link href="/login" className="btn btn-dark btn-lg">
            Sign in to your workspace
            <ArrowRight size={17} />
          </Link>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 py-8 text-sm text-text-muted sm:flex-row sm:items-center sm:justify-between">
        <Logo />
        <p>Order operations for wholesale teams.</p>
        <Link href="/login" className="font-medium text-ink underline-offset-4 hover:underline">
          Sign in
        </Link>
      </div>
    </footer>
  );
}
