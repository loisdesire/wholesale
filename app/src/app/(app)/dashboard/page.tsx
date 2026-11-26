import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { formatMoney, formatRelativeTime } from "@/lib/format";
import { OrderStatusBadge } from "@/components/status-badge";
import { Avatar } from "@/components/avatar";
import { getOwnerAIBriefing } from "@/lib/owner-ai";
import { OwnerAIBriefingCard } from "@/components/owner-ai-briefing";
import { DashboardAttentionConsole } from "@/components/dashboard-attention-console";
import { DebtReminderDrafts } from "@/components/debt-reminder-drafts";
import { GettingStarted } from "@/components/getting-started";
import { getChannelStatus } from "@/lib/channels";

const URGENCY_STYLE: Record<string, string> = {
  CRITICAL: "bg-status-attention-bg text-status-attention-fg",
  WARNING: "bg-status-progress-bg text-status-progress-fg",
  WATCH: "bg-status-neutral-bg text-status-neutral-fg",
};

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId;
  const db = tenantDb(organizationId);

  const [
    attentionConversations,
    attentionOrders,
    attentionReturns,
    pipelineCounts,
    recentOrders,
    recentMessages,
    organization,
    ownerBriefing,
    productCount,
    channels,
  ] = await Promise.all([
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
    db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    }),
    getOwnerAIBriefing(organizationId),
    db.product.count({ where: { organizationId } }),
    getChannelStatus(organizationId),
  ]);
  // Nothing has happened yet: show what to do next instead of "All caught up".
  const isBrandNew = recentOrders.length === 0 && recentMessages.length === 0;

  const pipelineOrder = ["DRAFT", "CONFIRMED", "PAID", "PARTIALLY_FULFILLED", "FULFILLED"] as const;
  const countByStatus = Object.fromEntries(pipelineCounts.map((row) => [row.status, row._count._all]));
  const valueByStatus = Object.fromEntries(pipelineCounts.map((row) => [row.status, row._sum.totalCents ?? 0]));
  const pipelineMax = Math.max(1, ...pipelineOrder.map((st) => countByStatus[st] ?? 0));
  const currency = recentOrders[0]?.currency ?? "NGN";

  const today = new Date().toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long" });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="flex flex-col gap-6">
      <header className="page-head">
        <div>
          <h1 className="page-title">
            {greeting}, {session!.user.name?.split(" ")[0]}
          </h1>
          <p className="mt-0.5 text-sm text-text-muted">
            {organization?.name ?? "Wholesale"} · {today}
          </p>
        </div>
        <Link href="/orders/new" className="btn btn-primary">
          <Plus size={16} strokeWidth={2.4} />
          New order
        </Link>
      </header>

      {/* Desk layout: the day's money and the work queue lead in the main column; the pipeline,
          stock risk and reminders are reference, so they live in the side rail. */}
      <div className="rail-layout">
        <div>
          <OwnerAIBriefingCard briefing={ownerBriefing} />
          {isBrandNew ? (
            <GettingStarted productCount={productCount} isOwner={session!.user.role === "OWNER"} channelConnected={channels.whatsapp || channels.telegram} />
          ) : (
            <DashboardAttentionConsole
              conversations={attentionConversations}
              orders={attentionOrders}
              returns={attentionReturns}
            />
          )}

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="section-title">Recent orders</h2>
              <Link href="/orders" className="link inline-flex items-center gap-1 text-sm">
                All <ArrowRight size={14} />
              </Link>
            </div>
            {recentOrders.length === 0 ? (
              <div className="empty">No orders yet.</div>
            ) : (
              <div className="card divide-y divide-line overflow-hidden">
                {recentOrders.map((o, i) => (
                  <Link key={o.id} href={`/orders/${o.id}`} className={`mrow transition-colors hover:bg-paper/70 ${i >= 3 ? "hidden lg:flex" : ""}`}>
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
                      <span className={`block h-full rounded-full ${STAGE_TONE[status]}`} style={{ width: `${(count / pipelineMax) * 100}%` }} />
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

          {ownerBriefing.stockoutRisks.length > 0 && (
            <section>
              <h2 className="section-title">Running low</h2>
              <p className="mb-3 text-xs text-text-muted">Out of stock, or about to be, based on the last 7 days of sales.</p>
              <div className="card divide-y divide-line overflow-hidden">
                {ownerBriefing.stockoutRisks.map((risk, i) => (
                  <Link key={risk.productId} href={`/catalogue/${risk.productId}`} className={`block px-4 py-3 transition-colors hover:bg-paper/70 ${i >= 3 ? "hidden lg:block" : ""}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 text-sm font-medium text-ink">
                        {risk.name}
                        {risk.variant ? <span className="text-text-muted"> · {risk.variant}</span> : null}
                      </p>
                      <span className="shrink-0 font-tabular text-sm font-semibold text-ink">{risk.available} left</span>
                    </div>
                    <p className="mt-1.5 flex items-start gap-2 text-xs text-text-muted">
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${URGENCY_STYLE[risk.urgency] ?? URGENCY_STYLE.WATCH}`}>
                        {risk.urgency.charAt(0) + risk.urgency.slice(1).toLowerCase()}
                      </span>
                      <span className="min-w-0">{risk.recommendation}</span>
                    </p>
                  </Link>
                ))}
              </div>
              <Link href="/catalogue" className="link mt-2 inline-flex items-center gap-1 text-sm">
                All stock <ArrowRight size={14} />
              </Link>
            </section>
          )}

          <DebtReminderDrafts debtors={ownerBriefing.debtDrafts} />

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="section-title">Latest messages</h2>
              <Link href="/inbox" className="link inline-flex items-center gap-1 text-sm">
                Inbox <ArrowRight size={14} />
              </Link>
            </div>
            {recentMessages.length === 0 ? (
              <div className="empty">No messages yet.</div>
            ) : (
              <div className="card divide-y divide-line overflow-hidden">
                {recentMessages.map((m, i) => (
                  <Link key={m.id} href={`/inbox/${m.conversationId}`} className={`items-start gap-3 px-4 py-3 text-sm transition-colors hover:bg-paper/70 ${i >= 3 ? "hidden lg:flex" : "flex"}`}>
                    <Avatar name={m.conversation.customer.name ?? m.conversation.customer.phone} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate font-medium text-ink">{m.conversation.customer.name ?? m.conversation.customer.phone}</span>
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

// One colour per stage, so the bar and its row read together.
const STAGE_TONE: Record<string, string> = {
  DRAFT: "bg-[#aab1c0]",
  CONFIRMED: "bg-[#f0a41c]",
  PAID: "bg-accent",
  PARTIALLY_FULFILLED: "bg-[#7c8cf8]",
  FULFILLED: "bg-[#18a66a]",
};
