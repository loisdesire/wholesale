import Link from "next/link";
import type { ConversationStatus, OrderStatus, ReturnStatus } from "@prisma/client";
import { ChevronRight, CheckCheck, MessageCircle, ReceiptText, Undo2 } from "lucide-react";
import { formatMoney, formatRelativeTime } from "@/lib/format";

export type AttentionConversation = {
  id: string;
  status: ConversationStatus;
  channel: "WHATSAPP" | "TELEGRAM";
  lastMessageAt: Date | string;
  customer: { name: string | null; phone: string };
};

export type AttentionOrder = {
  id: string;
  reference: string;
  status: OrderStatus;
  totalCents: number;
  currency: string;
  customer: { name: string | null; phone: string };
};

export type AttentionReturn = {
  id: string;
  reference: string;
  status: ReturnStatus;
  orderId: string;
  refundCents: number;
  customer: { name: string | null; phone: string };
  order: { reference: string; currency: string };
};

const CHANNEL_LABEL = { WHATSAPP: "WhatsApp", TELEGRAM: "Telegram" } as const;

/** The work queue: everything waiting on a person, one tappable row each. */
const PHONE_ROWS = 4;

export function DashboardAttentionConsole({
  conversations,
  orders,
  returns,
}: {
  conversations: AttentionConversation[];
  orders: AttentionOrder[];
  returns: AttentionReturn[];
}) {
  const total = conversations.length + orders.length + returns.length;

  if (total === 0) {
    return (
      <section className="flex items-center gap-4 rounded-2xl bg-ink px-5 py-6 text-white">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold text-gold-ink">
          <CheckCheck size={20} />
        </span>
        <p className="font-display text-xl font-semibold">All caught up</p>
      </section>
    );
  }

  const rows: { key: string; props: Omit<Parameters<typeof Row>[0], "className"> }[] = [
    ...conversations.map((c) => ({
      key: `c-${c.id}`,
      props: {
        href: `/inbox/${c.id}`,
        icon: <MessageCircle size={16} />,
        title: c.customer.name ?? c.customer.phone,
        detail: `${CHANNEL_LABEL[c.channel]} · waiting on a reply`,
        meta: formatRelativeTime(typeof c.lastMessageAt === "string" ? new Date(c.lastMessageAt) : c.lastMessageAt),
      },
    })),
    ...orders.map((o) => ({
      key: `o-${o.id}`,
      props: {
        href: `/orders/${o.id}`,
        icon: <ReceiptText size={16} />,
        title: o.customer.name ?? o.customer.phone,
        detail: `${o.reference} · ${o.status === "DRAFT" ? "Confirm it" : "Awaiting payment"}`,
        meta: formatMoney(o.totalCents, o.currency),
      },
    })),
    ...returns.map((r) => ({
      key: `r-${r.id}`,
      props: {
        href: `/orders/${r.orderId}`,
        icon: <Undo2 size={16} />,
        title: r.customer.name ?? r.customer.phone,
        detail: `${r.reference} · ${r.status === "REQUESTED" ? "Decide the return" : "Return open"}`,
        meta: formatMoney(r.refundCents, r.order.currency),
      },
    })),
  ];

  return (
    <section className="overflow-hidden rounded-2xl bg-ink text-white">
      <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4 sm:px-5">
        <h2 className="flex items-center gap-3 font-display text-lg font-semibold">
          <span className="flex h-8 min-w-8 items-center justify-center rounded-lg bg-gold px-2 text-base font-bold text-gold-ink">
            {total}
          </span>
          {total === 1 ? "needs you" : "need you"}
        </h2>
        <Link href="/operations#attention" className="text-sm font-medium text-white/70 hover:text-white">
          Operations
        </Link>
      </div>
      <div className="divide-y divide-white/10 border-t border-white/10">
        {rows.map((row, i) => (
          // A phone shows the first few; a desk shows them all. The rest are one tap away in Operations.
          <Row key={row.key} {...row.props} className={i >= PHONE_ROWS ? "hidden md:flex" : "flex"} />
        ))}
      </div>
      {total > PHONE_ROWS && (
        <Link href="/operations#attention" className="block border-t border-white/10 px-4 py-3 text-center text-sm font-medium text-white/70 hover:text-white md:hidden">
          See all {total}
        </Link>
      )}
    </section>
  );
}

function Row({ href, icon, title, detail, meta, className = "flex" }: { href: string; icon: React.ReactNode; title: string; detail: string; meta: string; className?: string }) {
  return (
    <Link href={href} className={`group items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-white/[0.06] sm:px-5 ${className}`}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-gold">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-white">{title}</p>
        <p className="break-words text-white/70">{detail}</p>
      </div>
      <span className="shrink-0 font-tabular text-xs text-white/70">{meta}</span>
      <ChevronRight size={16} className="shrink-0 text-white/30 transition-colors group-hover:text-gold" />
    </Link>
  );
}
