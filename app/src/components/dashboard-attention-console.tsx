"use client";

import Link from "next/link";
import type { ConversationStatus, OrderStatus, ReturnStatus } from "@prisma/client";
import { formatMoney, formatRelativeTime } from "@/lib/format";
import { ConversationStatusBadge, OrderStatusBadge, ReturnStatusBadge } from "@/components/status-badge";
import { ArrowRight, ChevronRight, CheckCircle2 } from "lucide-react";

export type AttentionConversation = {
  id: string;
  status: ConversationStatus;
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
      <section className="card-base p-6 sm:p-8 flex items-center justify-between border border-line rounded-2xl shadow-xs">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-ink">Everything is running smoothly</h2>
            <p className="text-xs text-text-muted mt-0.5">
              All customer WhatsApp inquiries, pending order quotes, and returns are currently resolved.
            </p>
          </div>
        </div>
        <Link
          href="/orders"
          className="hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent-2"
        >
          <span>View order ledger</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </section>
    );
  }

  return (
    <section className="card-base overflow-hidden rounded-2xl shadow-xs border border-line">
      {/* Header Strip: Clean, high-contrast, calm */}
      <div className="flex items-center justify-between border-b border-line bg-paper/60 px-5 py-3.5 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent font-display text-sm font-bold text-white shadow-xs shadow-accent/25">
            {totalCount}
          </div>
          <div>
            <h2 className="font-display text-sm sm:text-base font-bold text-ink">
              {totalCount === 1 ? "1 item requires" : `${totalCount} items require`} immediate attention
            </h2>
            <span className="text-xs text-text-muted">High-priority operational queue</span>
          </div>
        </div>

        <Link
          href="/operations#attention"
          className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-paper transition-all cursor-pointer shadow-2xs"
        >
          <span>Full Operations Desk</span>
          <ArrowRight className="h-3.5 w-3.5 text-ink/60" />
        </Link>
      </div>

      {/* Structured Table: No column headers, uniform rhythm, missing fields indicated with "—" */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs table-fixed min-w-[720px]">
          <tbody className="divide-y divide-line/60">
            {/* 1. WhatsApp Conversations */}
            {conversations.map((c) => (
              <tr key={c.id} className="group hover:bg-paper/40 transition-colors">
                {/* Column 1: Type Pill */}
                <td className="w-24 pl-5 pr-2 py-3.5 align-middle">
                  <Link href={`/inbox/${c.id}`} className="inline-block">
                    <span className="font-mono text-xs uppercase font-bold text-amber-900 bg-amber-500/10 border border-amber-500/25 px-2 py-0.5 rounded">
                      WhatsApp
                    </span>
                  </Link>
                </td>

                {/* Column 2: Status Pill */}
                <td className="w-36 px-2 py-3.5 align-middle">
                  <Link href={`/inbox/${c.id}`} className="inline-block">
                    <ConversationStatusBadge status={c.status} />
                  </Link>
                </td>

                {/* Column 3: Reference (Dash if none) */}
                <td className="w-28 px-2 py-3.5 align-middle">
                  <Link href={`/inbox/${c.id}`} className="block font-mono text-ink/40 font-bold select-none">
                    —
                  </Link>
                </td>

                {/* Column 4: Customer Name & Phone */}
                <td className="w-48 px-2 py-3.5 align-middle">
                  <Link href={`/inbox/${c.id}`} className="block group-hover:text-accent transition-colors truncate">
                    <span className="font-semibold text-ink block truncate">{c.customer.name ?? c.customer.phone}</span>
                    {c.customer.name && <span className="font-mono text-[11px] text-text-muted">{c.customer.phone}</span>}
                  </Link>
                </td>

                {/* Column 5: Operational Note */}
                <td className="px-2 py-3.5 align-middle text-ink/75 truncate">
                  <Link href={`/inbox/${c.id}`} className="block truncate">
                    Awaiting staff response to buyer inquiry
                  </Link>
                </td>

                {/* Column 6: Amount / Recency */}
                <td className="w-28 px-2 py-3.5 text-right align-middle font-tabular font-medium text-ink/75">
                  <Link href={`/inbox/${c.id}`} className="block">
                    {formatRelativeTime(typeof c.lastMessageAt === "string" ? new Date(c.lastMessageAt) : c.lastMessageAt)}
                  </Link>
                </td>

                {/* Column 7: Action Chevron */}
                <td className="w-8 pl-1 pr-5 py-3.5 text-right align-middle">
                  <Link href={`/inbox/${c.id}`} className="inline-block">
                    <ChevronRight className="h-4 w-4 text-ink/40 group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
                  </Link>
                </td>
              </tr>
            ))}

            {/* 2. Orders */}
            {orders.map((o) => (
              <tr key={o.id} className="group hover:bg-paper/40 transition-colors">
                {/* Column 1: Type Pill */}
                <td className="w-24 pl-5 pr-2 py-3.5 align-middle">
                  <Link href={`/orders/${o.id}`} className="inline-block">
                    <span className="font-mono text-xs uppercase font-bold text-accent bg-accent/10 border border-accent/25 px-2 py-0.5 rounded">
                      Order
                    </span>
                  </Link>
                </td>

                {/* Column 2: Status Pill */}
                <td className="w-36 px-2 py-3.5 align-middle">
                  <Link href={`/orders/${o.id}`} className="inline-block">
                    <OrderStatusBadge status={o.status} />
                  </Link>
                </td>

                {/* Column 3: Order Reference */}
                <td className="w-28 px-2 py-3.5 align-middle">
                  <Link href={`/orders/${o.id}`} className="inline-flex items-center rounded-md bg-paper/80 border border-line px-2 py-0.5 font-mono text-xs font-bold text-ink group-hover:border-accent/40 transition-colors">
                    {o.reference}
                  </Link>
                </td>

                {/* Column 4: Customer Name & Phone */}
                <td className="w-48 px-2 py-3.5 align-middle">
                  <Link href={`/orders/${o.id}`} className="block group-hover:text-accent transition-colors truncate">
                    <span className="font-semibold text-ink block truncate">{o.customer.name ?? o.customer.phone}</span>
                    {o.customer.name && <span className="font-mono text-[11px] text-text-muted">{o.customer.phone}</span>}
                  </Link>
                </td>

                {/* Column 5: Operational Note */}
                <td className="px-2 py-3.5 align-middle text-ink/75 truncate">
                  <Link href={`/orders/${o.id}`} className="block truncate">
                    {o.status === "DRAFT" ? "Quote review pending confirmation" : "Stock reserved, awaiting bank transfer"}
                  </Link>
                </td>

                {/* Column 6: Amount */}
                <td className="w-28 px-2 py-3.5 text-right align-middle font-tabular font-bold text-ink">
                  <Link href={`/orders/${o.id}`} className="block">
                    {formatMoney(o.totalCents, o.currency)}
                  </Link>
                </td>

                {/* Column 7: Action Chevron */}
                <td className="w-8 pl-1 pr-5 py-3.5 text-right align-middle">
                  <Link href={`/orders/${o.id}`} className="inline-block">
                    <ChevronRight className="h-4 w-4 text-ink/40 group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
                  </Link>
                </td>
              </tr>
            ))}

            {/* 3. Returns */}
            {returns.map((r) => (
              <tr key={r.id} className="group hover:bg-paper/40 transition-colors">
                {/* Column 1: Type Pill */}
                <td className="w-24 pl-5 pr-2 py-3.5 align-middle">
                  <Link href={`/orders/${r.orderId}`} className="inline-block">
                    <span className="font-mono text-xs uppercase font-bold text-rose-700 bg-rose-500/10 border border-rose-500/25 px-2 py-0.5 rounded">
                      Return
                    </span>
                  </Link>
                </td>

                {/* Column 2: Status Pill */}
                <td className="w-36 px-2 py-3.5 align-middle">
                  <Link href={`/orders/${r.orderId}`} className="inline-block">
                    <ReturnStatusBadge status={r.status} />
                  </Link>
                </td>

                {/* Column 3: Return Reference */}
                <td className="w-28 px-2 py-3.5 align-middle">
                  <Link href={`/orders/${r.orderId}`} className="inline-flex items-center rounded-md bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 font-mono text-xs font-bold text-rose-900 group-hover:border-rose-500/40 transition-colors">
                    {r.reference}
                  </Link>
                </td>

                {/* Column 4: Customer Name & Phone */}
                <td className="w-48 px-2 py-3.5 align-middle">
                  <Link href={`/orders/${r.orderId}`} className="block group-hover:text-accent transition-colors truncate">
                    <span className="font-semibold text-ink block truncate">{r.customer.name ?? r.customer.phone}</span>
                    {r.customer.name && <span className="font-mono text-[11px] text-text-muted">{r.customer.phone}</span>}
                  </Link>
                </td>

                {/* Column 5: Operational Note */}
                <td className="px-2 py-3.5 align-middle text-ink/75 truncate">
                  <Link href={`/orders/${r.orderId}`} className="block truncate">
                    Order {r.order.reference} inspection &amp; refund review
                  </Link>
                </td>

                {/* Column 6: Amount */}
                <td className="w-28 px-2 py-3.5 text-right align-middle font-tabular font-bold text-rose-700">
                  <Link href={`/orders/${r.orderId}`} className="block">
                    {formatMoney(r.refundCents, r.order.currency)}
                  </Link>
                </td>

                {/* Column 7: Action Chevron */}
                <td className="w-8 pl-1 pr-5 py-3.5 text-right align-middle">
                  <Link href={`/orders/${r.orderId}`} className="inline-block">
                    <ChevronRight className="h-4 w-4 text-ink/40 group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
