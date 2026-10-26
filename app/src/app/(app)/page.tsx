import type { ReactNode } from "react";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { formatMoney, formatRelativeTime } from "@/lib/format";
import { ConversationStatusBadge, OrderStatusBadge, ReturnStatusBadge } from "@/components/status-badge";

export default async function DashboardPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId;
  const db = tenantDb(organizationId);

  const [attentionConversations, attentionOrders, attentionReturns, pipelineCounts, recentOrders, recentMessages] =
    await Promise.all([
      db.conversation.findMany({
        where: { organizationId, status: { in: ["AWAITING_STAFF", "NEW"] } },
        include: { customer: true },
        orderBy: { lastMessageAt: "asc" },
        take: 6,
      }),
      db.order.findMany({
        where: { organizationId, status: { in: ["DRAFT", "CONFIRMED"] } },
        include: { customer: true },
        orderBy: { createdAt: "asc" },
        take: 6,
      }),
      // Returns still needing someone: a decision, the goods booked in, or the refund paid.
      db.orderReturn.findMany({
        where: {
          organizationId,
          OR: [{ status: { in: ["REQUESTED", "APPROVED"] } }, { refundStatus: "PENDING" }],
        },
        include: { customer: true, order: true },
        orderBy: { createdAt: "asc" },
        take: 6,
      }),
      db.order.groupBy({
        by: ["status"],
        where: { organizationId },
        _count: { _all: true },
      }),
      db.order.findMany({
        where: { organizationId },
        include: { customer: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      db.message.findMany({
        where: { conversation: { organizationId } },
        include: { conversation: { include: { customer: true } } },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

  const pipelineOrder = ["DRAFT", "CONFIRMED", "PAID", "PARTIALLY_FULFILLED", "FULFILLED"] as const;
  const countByStatus = Object.fromEntries(
    pipelineCounts.map((row) => [row.status, row._count._all])
  );

  const needsAttentionCount =
    attentionConversations.length + attentionOrders.length + attentionReturns.length;

  const today = new Date().toLocaleDateString("en-NG", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-text-muted">{today}</p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-ink">
            Good to see you, {session!.user.name?.split(" ")[0]}
          </h1>
        </div>
        <Link
          href="/operations"
          className="text-sm font-medium text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-ink"
        >
          Operations &amp; metrics
        </Link>
      </header>

      {needsAttentionCount === 0 ? (
        <section className="rounded-2xl border border-dashed border-line bg-surface px-8 py-10 text-center">
          <p className="text-sm text-text-muted">Nothing is waiting on you right now.</p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-2xl bg-ink text-paper">
          <div className="flex flex-col gap-5 px-6 py-7 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <div className="flex items-baseline gap-4">
              <span className="font-display text-5xl font-semibold text-accent">
                {needsAttentionCount}
              </span>
              <div>
                <p className="font-medium text-white">
                  {needsAttentionCount === 1 ? "thing needs" : "things need"} you today
                </p>
                <p className="text-sm text-white/55">
                  Replies to send, orders to confirm, returns to decide.
                </p>
              </div>
            </div>
          </div>

          <div className="divide-y divide-white/10 border-t border-white/10">
            {attentionConversations.map((c) => (
              <AttentionRow key={c.id} href={`/inbox/${c.id}`}>
                <ConversationStatusBadge status={c.status} />
                <span className="font-medium text-white">
                  {c.customer.name ?? c.customer.phone}
                </span>
                <span className="text-white/55">waiting on a reply</span>
                <span className="ml-auto shrink-0 font-tabular text-xs text-white/40">
                  {formatRelativeTime(c.lastMessageAt)}
                </span>
              </AttentionRow>
            ))}
            {attentionOrders.map((o) => (
              <AttentionRow key={o.id} href={`/orders/${o.id}`}>
                <OrderStatusBadge status={o.status} />
                <span className="font-tabular text-white">{o.reference}</span>
                <span className="text-white/55">
                  {o.status === "DRAFT" ? "needs confirmation" : "awaiting payment"} ·{" "}
                  {o.customer.name ?? o.customer.phone}
                </span>
                <span className="ml-auto shrink-0 font-tabular text-xs text-white/40">
                  {formatMoney(o.totalCents, o.currency)}
                </span>
              </AttentionRow>
            ))}
            {attentionReturns.map((r) => (
              <AttentionRow key={r.id} href={`/orders/${r.orderId}`}>
                <ReturnStatusBadge status={r.status} />
                <span className="font-tabular text-white">{r.reference}</span>
                <span className="text-white/55">
                  {r.status === "REQUESTED"
                    ? "return needs a decision"
                    : r.refundStatus === "PENDING" && r.status === "RECEIVED"
                      ? "refund to pay"
                      : r.status === "APPROVED"
                        ? "approved, awaiting goods"
                        : "return open"}{" "}
                  · {r.customer.name ?? r.customer.phone}
                </span>
                <span className="ml-auto shrink-0 font-tabular text-xs text-white/40">
                  {formatMoney(r.refundCents, r.order.currency)}
                </span>
              </AttentionRow>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-4 text-sm font-medium text-ink">Order pipeline</h2>
        {/* The lifecycle genuinely is a sequence, so a connected strip earns the structure a
            plain stat grid wouldn't — each stage reads as a step, not an interchangeable box. */}
        <div className="relative">
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <div className="flex divide-x divide-line">
              {pipelineOrder.map((status) => (
                <div key={status} className="min-w-[150px] flex-1 px-6 py-5">
                  <p className="font-display text-3xl font-semibold text-ink">
                    {countByStatus[status] ?? 0}
                  </p>
                  <p className="mt-1 whitespace-nowrap text-xs text-text-muted">
                    {STATUS_LABEL[status]}
                  </p>
                </div>
              ))}
            </div>
          </div>
          {/* Hints that the strip scrolls on a screen too narrow to show all five stages. */}
          <div className="pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-2xl bg-gradient-to-l from-surface to-transparent sm:hidden" />
        </div>
      </section>

      <section className="grid gap-x-10 gap-y-10 lg:grid-cols-2">
        <div className="min-w-0">
          <h2 className="mb-4 text-sm font-medium text-ink">Recent orders</h2>
          {recentOrders.length === 0 ? (
            <EmptyRow text="No orders yet." />
          ) : (
            <div className="divide-y divide-line">
              {recentOrders.map((o) => (
                <Link
                  key={o.id}
                  href={`/orders/${o.id}`}
                  className="flex items-center gap-3 py-3.5 text-sm transition-colors hover:text-accent"
                >
                  <Initials name={o.customer.name ?? o.customer.phone} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink group-hover:text-accent">
                      {o.customer.name ?? o.customer.phone}
                    </p>
                    <p className="font-tabular text-xs text-text-muted">{o.reference}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-tabular text-ink">
                      {formatMoney(o.totalCents, o.currency)}
                    </span>
                    <OrderStatusBadge status={o.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0">
          <h2 className="mb-4 text-sm font-medium text-ink">Today&apos;s activity</h2>
          {recentMessages.length === 0 ? (
            <EmptyRow text="No conversation activity yet." />
          ) : (
            <div className="divide-y divide-line">
              {recentMessages.map((m) => (
                <Link
                  key={m.id}
                  href={`/inbox/${m.conversationId}`}
                  className="flex items-start gap-3 py-3.5 text-sm"
                >
                  <Initials name={m.conversation.customer.name ?? m.conversation.customer.phone} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate font-medium text-ink">
                        {m.conversation.customer.name ?? m.conversation.customer.phone}
                      </span>
                      <span className="shrink-0 font-tabular text-xs text-text-muted">
                        {formatRelativeTime(m.createdAt)}
                      </span>
                    </div>
                    <p className="truncate text-text-muted">{m.body}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  CONFIRMED: "Confirmed, awaiting payment",
  PAID: "Paid, awaiting fulfillment",
  PARTIALLY_FULFILLED: "Partly shipped",
  FULFILLED: "Fulfilled",
};

function AttentionRow({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-3 px-6 py-3.5 text-sm transition-colors hover:bg-white/5 sm:px-8">
      {children}
    </Link>
  );
}

function Initials({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 font-display text-sm font-semibold text-accent-2">
      {initials || "?"}
    </span>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-text-muted">
      {text}
    </div>
  );
}
