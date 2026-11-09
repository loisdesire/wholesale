"use client";

import Link from "next/link";
import type { ConversationStatus, OrderStatus, ReturnStatus } from "@prisma/client";
import { formatMoney, formatRelativeTime } from "@/lib/format";
import { ConversationStatusBadge, OrderStatusBadge, ReturnStatusBadge } from "@/components/status-badge";
import { ChevronRight, CheckCircle2 } from "lucide-react";

export type AttentionConversation = {
  id: string;
  status: ConversationStatus;
  channel: "WHATSAPP" | "TELEGRAM";
  lastMessageAt: Date | string;
  customer: {
    name: string | null;
    phone: string;
  };
};

export type AttentionOrder = {
  id: string;
  reference: string;
  status: OrderStatus;
  totalCents: number;
  currency: string;
  customer: {
    name: string | null;
    phone: string;
  };
};

export type AttentionReturn = {
  id: string;
  reference: string;
  status: ReturnStatus;
  orderId: string;
  refundCents: number;
  customer: {
    name: string | null;
    phone: string;
  };
  order: {
    reference: string;
    currency: string;
  };
};

interface DashboardAttentionConsoleProps {
  conversations: AttentionConversation[];
  orders: AttentionOrder[];
  returns: AttentionReturn[];
}

export function DashboardAttentionConsole({
  conversations,
  orders,
  returns,
}: DashboardAttentionConsoleProps) {
  const totalCount = conversations.length + orders.length + returns.length;

  if (totalCount === 0) {
    return (
      <section className="flex items-center justify-between border-b border-line py-5">
        <div className="flex items-center gap-3.5">
          <CheckCircle2 className="h-5 w-5 text-status-success-fg" />
          <div>
            <h2 className="font-display text-base font-semibold text-ink">Nothing needs you right now</h2>
            <p className="text-xs text-text-muted mt-0.5">
              Every buyer inquiry, draft quote, and return is resolved.
            </p>
          </div>
        </div>
        <Link href="/orders" className="hidden sm:inline text-xs font-medium text-accent hover:text-accent-2">
          View order ledger
        </Link>
      </section>
    );
  }

  const CHANNEL_LABEL: Record<AttentionConversation["channel"], string> = {
    WHATSAPP: "WhatsApp",
    TELEGRAM: "Telegram",
  };

  return (
    <section className="border-b border-line py-5">
      <div className="flex items-baseline justify-between pb-3">
        <h2 className="font-display text-base font-semibold text-ink">
          Needs attention <span className="font-tabular text-text-muted font-normal">· {totalCount}</span>
        </h2>
        <Link href="/operations#attention" className="text-xs font-medium text-accent hover:text-accent-2">
          Full operations desk
        </Link>
      </div>

      <div className="divide-y divide-line/70">
        {conversations.map((c) => (
          <Link
            key={c.id}
            href={`/inbox/${c.id}`}
            className="group flex items-center gap-4 py-3 -mx-1 px-1 hover:bg-surface transition-colors"
          >
            <div className="w-24 shrink-0 text-xs text-text-muted">{CHANNEL_LABEL[c.channel]}</div>
            <div className="w-32 shrink-0"><ConversationStatusBadge status={c.status} /></div>
            <div className="w-44 shrink-0 truncate">
              <span className="font-medium text-ink group-hover:text-accent transition-colors">
                {c.customer.name ?? c.customer.phone}
              </span>
            </div>
            <div className="flex-1 min-w-0 truncate text-ink/70">Waiting on a reply</div>
            <div className="shrink-0 font-tabular text-xs text-text-muted">
              {formatRelativeTime(typeof c.lastMessageAt === "string" ? new Date(c.lastMessageAt) : c.lastMessageAt)}
            </div>
            <ChevronRight className="h-4 w-4 text-ink/30 group-hover:text-accent transition-colors shrink-0" />
          </Link>
        ))}

        {orders.map((o) => (
          <Link
            key={o.id}
            href={`/orders/${o.id}`}
            className="group flex items-center gap-4 py-3 -mx-1 px-1 hover:bg-surface transition-colors"
          >
            <div className="w-24 shrink-0 font-mono text-xs text-text-muted">{o.reference}</div>
            <div className="w-32 shrink-0"><OrderStatusBadge status={o.status} /></div>
            <div className="w-44 shrink-0 truncate">
              <span className="font-medium text-ink group-hover:text-accent transition-colors">
                {o.customer.name ?? o.customer.phone}
              </span>
            </div>
            <div className="flex-1 min-w-0 truncate text-ink/70">
              {o.status === "DRAFT" ? "Quote awaiting confirmation" : "Stock reserved, awaiting payment"}
            </div>
            <div className="shrink-0 font-tabular text-sm font-semibold text-ink">
              {formatMoney(o.totalCents, o.currency)}
            </div>
            <ChevronRight className="h-4 w-4 text-ink/30 group-hover:text-accent transition-colors shrink-0" />
          </Link>
        ))}

        {returns.map((r) => (
          <Link
            key={r.id}
            href={`/orders/${r.orderId}`}
            className="group flex items-center gap-4 py-3 -mx-1 px-1 hover:bg-surface transition-colors"
          >
            <div className="w-24 shrink-0 font-mono text-xs text-text-muted">{r.reference}</div>
            <div className="w-32 shrink-0"><ReturnStatusBadge status={r.status} /></div>
            <div className="w-44 shrink-0 truncate">
              <span className="font-medium text-ink group-hover:text-accent transition-colors">
                {r.customer.name ?? r.customer.phone}
              </span>
            </div>
            <div className="flex-1 min-w-0 truncate text-ink/70">
              Order {r.order.reference} — inspection &amp; refund
            </div>
            <div className="shrink-0 font-tabular text-sm font-semibold text-status-attention-fg">
              {formatMoney(r.refundCents, r.order.currency)}
            </div>
            <ChevronRight className="h-4 w-4 text-ink/30 group-hover:text-accent transition-colors shrink-0" />
          </Link>
        ))}
      </div>
    </section>
  );
}
