import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatMoney, formatRelativeTime } from "@/lib/format";
import { ConversationStatusBadge, OrderStatusBadge, ReturnStatusBadge } from "@/components/status-badge";

export default async function DashboardPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId;

  const [attentionConversations, attentionOrders, attentionReturns, pipelineCounts, recentOrders, recentMessages] =
    await Promise.all([
      prisma.conversation.findMany({
        where: { organizationId, status: { in: ["AWAITING_STAFF", "NEW"] } },
        include: { customer: true },
        orderBy: { lastMessageAt: "asc" },
        take: 6,
      }),
      prisma.order.findMany({
        where: { organizationId, status: { in: ["DRAFT", "CONFIRMED"] } },
        include: { customer: true },
        orderBy: { createdAt: "asc" },
        take: 6,
      }),
      // Returns still needing someone: a decision, the goods booked in, or the refund paid.
      prisma.orderReturn.findMany({
        where: {
          organizationId,
          OR: [{ status: { in: ["REQUESTED", "APPROVED"] } }, { refundStatus: "PENDING" }],
        },
        include: { customer: true, order: true },
        orderBy: { createdAt: "asc" },
        take: 6,
      }),
      prisma.order.groupBy({
        by: ["status"],
        where: { organizationId },
        _count: { _all: true },
      }),
      prisma.order.findMany({
        where: { organizationId },
        include: { customer: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.message.findMany({
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

  return (
    <div className="flex flex-col gap-10">
      <header>
        <h1 className="text-xl font-medium text-ink">
          Good to see you, {session!.user.name?.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Here&apos;s what&apos;s moving through Adaeze Wholesale today.
        </p>
      </header>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-ink">
            Needs attention{" "}
            {needsAttentionCount > 0 && (
              <span className="ml-1 text-text-muted">({needsAttentionCount})</span>
            )}
          </h2>
        </div>

        {needsAttentionCount === 0 ? (
          <EmptyRow text="Nothing is waiting on you right now." />
        ) : (
          <div className="divide-y divide-line rounded-md border border-line bg-surface">
            {attentionConversations.map((c) => (
              <Link
                key={c.id}
                href={`/inbox/${c.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-paper"
              >
                <div className="flex items-center gap-3">
                  <ConversationStatusBadge status={c.status} />
                  <span className="font-medium text-ink">
                    {c.customer.name ?? c.customer.phone}
                  </span>
                  <span className="text-text-muted">waiting on a reply</span>
                </div>
                <span className="font-tabular text-xs text-text-muted">
                  {formatRelativeTime(c.lastMessageAt)}
                </span>
              </Link>
            ))}
            {attentionOrders.map((o) => (
              <Link
                key={o.id}
                href={`/orders/${o.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-paper"
              >
                <div className="flex items-center gap-3">
                  <OrderStatusBadge status={o.status} />
                  <span className="font-tabular text-ink">{o.reference}</span>
                  <span className="text-text-muted">
                    {o.status === "DRAFT" ? "needs confirmation" : "awaiting payment"} ·{" "}
                    {o.customer.name ?? o.customer.phone}
                  </span>
                </div>
                <span className="font-tabular text-xs text-text-muted">
                  {formatMoney(o.totalCents, o.currency)}
                </span>
              </Link>
            ))}
            {attentionReturns.map((r) => (
              <Link
                key={r.id}
                href={`/orders/${r.orderId}`}
                className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-paper"
              >
                <div className="flex items-center gap-3">
                  <ReturnStatusBadge status={r.status} />
                  <span className="font-tabular text-ink">{r.reference}</span>
                  <span className="text-text-muted">
                    {r.status === "REQUESTED"
                      ? "return needs a decision"
                      : r.refundStatus === "PENDING" && r.status === "RECEIVED"
                        ? "refund to pay"
                        : r.status === "APPROVED"
                          ? "approved, awaiting goods"
                          : "return open"}{" "}
                    · {r.customer.name ?? r.customer.phone} · {r.order.reference}
                  </span>
                </div>
                <span className="font-tabular text-xs text-text-muted">
                  {formatMoney(r.refundCents, r.order.currency)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink">Order pipeline</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {pipelineOrder.map((status) => (
            <div
              key={status}
              className="rounded-md border border-line bg-surface px-4 py-3"
            >
              <p className="font-tabular text-2xl font-medium text-ink">
                {countByStatus[status] ?? 0}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                {STATUS_LABEL[status]}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm font-medium text-ink">Recent orders</h2>
          {recentOrders.length === 0 ? (
            <EmptyRow text="No orders yet." />
          ) : (
            <div className="divide-y divide-line rounded-md border border-line bg-surface">
              {recentOrders.map((o) => (
                <Link
                  key={o.id}
                  href={`/orders/${o.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-paper"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-tabular text-ink">{o.reference}</span>
                    <span className="text-text-muted">{o.customer.name ?? o.customer.phone}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-tabular text-text-muted">
                      {formatMoney(o.totalCents, o.currency)}
                    </span>
                    <OrderStatusBadge status={o.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-3 text-sm font-medium text-ink">Today&apos;s activity</h2>
          {recentMessages.length === 0 ? (
            <EmptyRow text="No conversation activity yet." />
          ) : (
            <div className="divide-y divide-line rounded-md border border-line bg-surface">
              {recentMessages.map((m) => (
                <Link
                  key={m.id}
                  href={`/inbox/${m.conversationId}`}
                  className="flex flex-col gap-0.5 px-4 py-3 text-sm hover:bg-paper"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-ink">
                      {m.conversation.customer.name ?? m.conversation.customer.phone}
                    </span>
                    <span className="font-tabular text-xs text-text-muted">
                      {formatRelativeTime(m.createdAt)}
                    </span>
                  </div>
                  <p className="truncate text-text-muted">{m.body}</p>
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

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-text-muted">
      {text}
    </div>
  );
}
