import type { ReactNode } from "react";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { formatMoney, formatRelativeTime } from "@/lib/format";
import { ArrowRight, ArrowUpRight, CheckCheck, MessageCircle, Plus, ReceiptText, Undo2 } from "lucide-react";
import { ConversationStatusBadge, OrderStatusBadge, ReturnStatusBadge } from "@/components/status-badge";
import { Avatar } from "@/components/avatar";

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
        _sum: { totalCents: true },
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
  const valueByStatus = Object.fromEntries(
    pipelineCounts.map((row) => [row.status, row._sum.totalCents ?? 0])
  );
  const pipelineTotal = pipelineOrder.reduce((sum, st) => sum + (countByStatus[st] ?? 0), 0);
  const currency = recentOrders[0]?.currency ?? "NGN";

  const needsAttentionCount =
    attentionConversations.length + attentionOrders.length + attentionReturns.length;

  const today = new Date().toLocaleDateString("en-NG", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">{today}</p>
          <h1 className="page-title mt-1.5">Good to see you, {session!.user.name?.split(" ")[0]}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/operations" className="btn btn-secondary">
            Operations &amp; metrics
          </Link>
          <Link href="/orders/new" className="btn btn-primary">
            <Plus size={16} strokeWidth={2.4} />
            New order
          </Link>
        </div>
      </header>

      {needsAttentionCount === 0 ? (
        <section className="flex items-center gap-4 rounded-2xl bg-ink px-6 py-7 text-white sm:px-8">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold text-gold-ink">
            <CheckCheck size={22} />
          </span>
          <div>
            <p className="font-display text-xl font-semibold">You&apos;re all caught up</p>
            <p className="text-sm text-white/60">Nothing is waiting on you right now.</p>
          </div>
        </section>
      ) : (
        <section className="overflow-hidden rounded-2xl bg-ink text-white shadow-pop">
          <div className="flex items-center gap-5 px-5 py-6 sm:px-7">
            <span className="flex h-16 min-w-16 items-center justify-center rounded-2xl bg-gold px-3 font-display text-4xl font-bold text-gold-ink">
              {needsAttentionCount}
            </span>
            <div className="min-w-0">
              <p className="font-display text-xl font-semibold sm:text-2xl">
                {needsAttentionCount === 1 ? "thing needs" : "things need"} you today
              </p>
              <p className="mt-0.5 text-sm text-white/60">Replies to send, orders to confirm, returns to decide.</p>
            </div>
          </div>

          <div className="flex flex-col gap-1 px-2 pb-2 sm:px-3 sm:pb-3">
            {attentionConversations.map((c) => (
              <AttentionRow
                key={c.id}
                href={`/inbox/${c.id}`}
                icon={<MessageCircle size={16} />}
                title={c.customer.name ?? c.customer.phone}
                detail="waiting on a reply"
                badge={<ConversationStatusBadge status={c.status} />}
                meta={formatRelativeTime(c.lastMessageAt)}
              />
            ))}
            {attentionOrders.map((o) => (
              <AttentionRow
                key={o.id}
                href={`/orders/${o.id}`}
                icon={<ReceiptText size={16} />}
                title={o.reference}
                detail={`${o.status === "DRAFT" ? "needs confirmation" : "awaiting payment"} · ${o.customer.name ?? o.customer.phone}`}
                badge={<OrderStatusBadge status={o.status} />}
                meta={formatMoney(o.totalCents, o.currency)}
              />
            ))}
            {attentionReturns.map((r) => (
              <AttentionRow
                key={r.id}
                href={`/orders/${r.orderId}`}
                icon={<Undo2 size={16} />}
                title={r.reference}
                detail={`${
                  r.status === "REQUESTED"
                    ? "return needs a decision"
                    : r.refundStatus === "PENDING" && r.status === "RECEIVED"
                      ? "refund to pay"
                      : r.status === "APPROVED"
                        ? "approved, awaiting goods"
                        : "return open"
                } · ${r.customer.name ?? r.customer.phone}`}
                badge={<ReturnStatusBadge status={r.status} />}
                meta={formatMoney(r.refundCents, r.order.currency)}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 className="section-title">Order pipeline</h2>
          <Link href="/orders" className="link inline-flex items-center gap-1 text-sm">
            All orders <ArrowRight size={14} />
          </Link>
        </div>
        {/* The lifecycle genuinely is a sequence, so it's drawn as one: a proportion bar showing
            where the open work sits, then each stage as a step that links to that slice. */}
        <div className="card p-4 sm:p-5">
          <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-paper" aria-hidden="true">
            {pipelineTotal > 0 &&
              pipelineOrder.map((status) =>
                (countByStatus[status] ?? 0) > 0 ? (
                  <span
                    key={status}
                    className={STAGE_TONE[status].bar}
                    style={{ flexGrow: countByStatus[status], flexBasis: 0 }}
                  />
                ) : null
              )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {pipelineOrder.map((status, i) => (
              <Link
                key={status}
                href={`/orders?status=${status}`}
                className="group relative rounded-xl border border-transparent px-3 py-3 transition-colors hover:border-line hover:bg-paper/70"
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${STAGE_TONE[status].bar}`} />
                  <span className="text-xs font-medium text-text-muted">
                    <span className="mr-1 font-tabular text-text-muted/70">{i + 1}</span>
                    {STATUS_LABEL[status]}
                  </span>
                </div>
                <p className="mt-2 font-display text-4xl font-bold leading-none text-ink">
                  {countByStatus[status] ?? 0}
                </p>
                <p className="mt-1.5 font-tabular text-xs text-text-muted">
                  {formatMoney(valueByStatus[status] ?? 0, currency)}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          <h2 className="section-title mb-3">Recent orders</h2>
          {recentOrders.length === 0 ? (
            <EmptyRow text="No orders yet." />
          ) : (
            <div className="card divide-y divide-line overflow-hidden">
              {recentOrders.map((o) => (
                <Link
                  key={o.id}
                  href={`/orders/${o.id}`}
                  className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-paper/70"
                >
                  <Avatar name={o.customer.name ?? o.customer.phone} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{o.customer.name ?? o.customer.phone}</p>
                    <p className="font-mono text-xs text-text-muted">{o.reference}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-tabular font-semibold text-ink">
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
          <h2 className="section-title mb-3">Latest messages</h2>
          {recentMessages.length === 0 ? (
            <EmptyRow text="No conversation activity yet." />
          ) : (
            <div className="card divide-y divide-line overflow-hidden">
              {recentMessages.map((m) => (
                <Link
                  key={m.id}
                  href={`/inbox/${m.conversationId}`}
                  className="flex items-start gap-3 px-4 py-3 text-sm transition-colors hover:bg-paper/70"
                >
                  <Avatar name={m.conversation.customer.name ?? m.conversation.customer.phone} />
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
  CONFIRMED: "Awaiting payment",
  PAID: "Paid, to ship",
  PARTIALLY_FULFILLED: "Partly shipped",
  FULFILLED: "Fulfilled",
};

// One colour per stage, reused by the proportion bar and the stage dots so the two read together.
const STAGE_TONE: Record<string, { bar: string }> = {
  DRAFT: { bar: "bg-[#aab1c0]" },
  CONFIRMED: { bar: "bg-[#f0a41c]" },
  PAID: { bar: "bg-accent" },
  PARTIALLY_FULFILLED: { bar: "bg-[#7c8cf8]" },
  FULFILLED: { bar: "bg-[#18a66a]" },
};

function AttentionRow({
  href,
  icon,
  title,
  detail,
  badge,
  meta,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  detail: string;
  badge: ReactNode;
  meta: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl bg-white/[0.06] px-3 py-3 text-sm transition-colors hover:bg-white/[0.12] sm:px-4"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-gold">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-white">{title}</span>
          {badge}
        </div>
        <p className="truncate text-white/60">{detail}</p>
      </div>
      <span className="shrink-0 font-tabular text-xs text-white/55">{meta}</span>
      <ArrowUpRight size={15} className="hidden shrink-0 text-white/30 transition-colors group-hover:text-gold sm:block" />
    </Link>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
