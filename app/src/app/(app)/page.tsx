import type { ReactNode } from "react";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { formatMoney, formatRelativeTime } from "@/lib/format";
import { ArrowRight, CheckCheck, ChevronRight, MessageCircle, Plus, ReceiptText, Undo2 } from "lucide-react";
import { OrderStatusBadge } from "@/components/status-badge";
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
  const currency = recentOrders[0]?.currency ?? "NGN";

  const needsAttentionCount =
    attentionConversations.length + attentionOrders.length + attentionReturns.length;

  const today = new Date().toLocaleDateString("en-NG", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const pipelineMax = Math.max(1, ...pipelineOrder.map((st) => countByStatus[st] ?? 0));

  return (
    <div className="flex flex-col gap-6">
      <header className="page-head">
        <div>
          <h1 className="page-title">Hi, {session!.user.name?.split(" ")[0]}</h1>
          <p className="mt-0.5 text-sm text-text-muted">{today}</p>
        </div>
        <Link href="/orders/new" className="btn btn-primary">
          <Plus size={16} strokeWidth={2.4} />
          New order
        </Link>
      </header>

      {/* Desk layout: the work queue leads in the main column; the pipeline and the latest
          messages are reference, so they live in the side rail. On a phone it is one column. */}
      <div className="rail-layout">
        <div>
          {needsAttentionCount === 0 ? (
            <section className="flex items-center gap-4 rounded-2xl bg-ink px-5 py-6 text-white">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold text-gold-ink">
                <CheckCheck size={20} />
              </span>
              <p className="font-display text-xl font-semibold">All caught up</p>
            </section>
          ) : (
            <section className="overflow-hidden rounded-2xl bg-ink text-white">
              <h2 className="flex items-center gap-3 px-4 pb-3 pt-4 font-display text-lg font-semibold sm:px-5">
                <span className="flex h-8 min-w-8 items-center justify-center rounded-lg bg-gold px-2 text-base font-bold text-gold-ink">
                  {needsAttentionCount}
                </span>
                {needsAttentionCount === 1 ? "needs you" : "need you"}
              </h2>
              <div className="divide-y divide-white/10 border-t border-white/10">
                {attentionConversations.map((c) => (
                  <AttentionRow
                    key={c.id}
                    href={`/inbox/${c.id}`}
                    icon={<MessageCircle size={16} />}
                    title={c.customer.name ?? c.customer.phone}
                    detail="Waiting on a reply"
                    meta={formatRelativeTime(c.lastMessageAt)}
                  />
                ))}
                {attentionOrders.map((o) => (
                  <AttentionRow
                    key={o.id}
                    href={`/orders/${o.id}`}
                    icon={<ReceiptText size={16} />}
                    title={o.customer.name ?? o.customer.phone}
                    detail={`${o.reference} · ${o.status === "DRAFT" ? "Confirm it" : "Awaiting payment"}`}
                    meta={formatMoney(o.totalCents, o.currency)}
                  />
                ))}
                {attentionReturns.map((r) => (
                  <AttentionRow
                    key={r.id}
                    href={`/orders/${r.orderId}`}
                    icon={<Undo2 size={16} />}
                    title={r.customer.name ?? r.customer.phone}
                    detail={`${r.reference} · ${
                      r.status === "REQUESTED"
                        ? "Decide the return"
                        : r.refundStatus === "PENDING" && r.status === "RECEIVED"
                          ? "Refund to pay"
                          : r.status === "APPROVED"
                            ? "Awaiting goods"
                            : "Return open"
                    }`}
                    meta={formatMoney(r.refundCents, r.order.currency)}
                  />
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="section-title">Recent orders</h2>
              <Link href="/orders" className="link inline-flex items-center gap-1 text-sm">
                All <ArrowRight size={14} />
              </Link>
            </div>
            {recentOrders.length === 0 ? (
              <EmptyRow text="No orders yet." />
            ) : (
              <div className="card divide-y divide-line overflow-hidden">
                {recentOrders.map((o) => (
                  <Link key={o.id} href={`/orders/${o.id}`} className="mrow transition-colors hover:bg-paper/70">
                    <Avatar name={o.customer.name ?? o.customer.phone} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{o.customer.name ?? o.customer.phone}</p>
                      <p className="font-mono text-xs text-text-muted">{o.reference}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="font-tabular font-semibold text-ink">{formatMoney(o.totalCents, o.currency)}</span>
                      <OrderStatusBadge status={o.status} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside>
          <section>
            <h2 className="section-title mb-3">Pipeline</h2>
            {/* One row per stage, in order. The bar is that stage's share of the busiest stage,
                so where the work is piling up is visible before a number is read. */}
            <div className="card divide-y divide-line overflow-hidden">
              {pipelineOrder.map((status) => {
                const count = countByStatus[status] ?? 0;
                return (
                  <Link
                    key={status}
                    href={`/orders?status=${status}`}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-paper/70"
                  >
                    <span className="w-28 shrink-0 text-ink">{STATUS_LABEL[status]}</span>
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-paper" aria-hidden="true">
                      <span
                        className={`block h-full rounded-full ${STAGE_TONE[status].bar}`}
                        style={{ width: `${(count / pipelineMax) * 100}%` }}
                      />
                    </span>
                    <span className="w-5 shrink-0 text-right font-tabular font-semibold text-ink">{count}</span>
                    <span className="hidden w-20 shrink-0 text-right font-tabular text-xs text-text-muted min-[420px]:block lg:hidden xl:block">
                      {formatMoney(valueByStatus[status] ?? 0, currency)}
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="section-title">Latest messages</h2>
              <Link href="/inbox" className="link inline-flex items-center gap-1 text-sm">
                Inbox <ArrowRight size={14} />
              </Link>
            </div>
            {recentMessages.length === 0 ? (
              <EmptyRow text="No messages yet." />
            ) : (
              <div className="card divide-y divide-line overflow-hidden">
                {recentMessages.map((m) => (
                  <Link
                    key={m.id}
                    href={`/inbox/${m.conversationId}`}
                    className="flex items-start gap-3 px-4 py-3 text-sm transition-colors hover:bg-paper/70"
                  >
                    <Avatar name={m.conversation.customer.name ?? m.conversation.customer.phone} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate font-medium text-ink">
                          {m.conversation.customer.name ?? m.conversation.customer.phone}
                        </span>
                        <span className="shrink-0 font-tabular text-xs text-text-muted">{formatRelativeTime(m.createdAt)}</span>
                      </div>
                      <p className="truncate text-text-muted">{m.body}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  CONFIRMED: "To be paid",
  PAID: "To ship",
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
  meta,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  detail: string;
  meta: string;
}) {
  return (
    <Link href={href} className="group flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-white/[0.06] sm:px-5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-gold">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-white">{title}</p>
        <p className="truncate text-white/60">{detail}</p>
      </div>
      <span className="shrink-0 font-tabular text-xs text-white/60">{meta}</span>
      <ChevronRight size={16} className="shrink-0 text-white/30 transition-colors group-hover:text-gold" />
    </Link>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
