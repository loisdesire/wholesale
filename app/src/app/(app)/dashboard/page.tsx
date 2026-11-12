import Link from "next/link";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { formatMoney, formatRelativeTime } from "@/lib/format";
import { OrderStatusBadge } from "@/components/status-badge";
import { getOwnerAIBriefing } from "@/lib/owner-ai";
import { OwnerAIBriefingCard } from "@/components/owner-ai-briefing";
import { DashboardAttentionConsole } from "@/components/dashboard-attention-console";
import { DebtReminderDrafts } from "@/components/debt-reminder-drafts";
import { Plus } from "lucide-react";

const URGENCY_LABEL: Record<string, string> = {
  CRITICAL: "text-status-attention-fg",
  WARNING: "text-status-progress-fg",
  WATCH: "text-text-muted",
};

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
  ]);

  const pipelineOrder = ["DRAFT", "CONFIRMED", "PAID", "PARTIALLY_FULFILLED", "FULFILLED"] as const;
  const countByStatus = Object.fromEntries(
    pipelineCounts.map((row) => [row.status, row._count._all])
  );
  const valueByStatus = Object.fromEntries(
    pipelineCounts.map((row) => [row.status, row._sum.totalCents ?? 0])
  );
  const totalPipelineOrders = Object.values(countByStatus).reduce((a, b) => a + b, 0);
  const totalPipelineValue = Object.values(valueByStatus).reduce((a, b) => a + b, 0);

  const today = new Date().toLocaleDateString("en-NG", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="flex flex-col pb-14 max-w-6xl mx-auto">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 pb-6">
        <div>
          <p className="text-sm text-text-muted">
            {organization?.name ?? "Wholesale"}, {today}
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            {greeting}, {session!.user.name?.split(" ")[0]}
          </h1>
        </div>

        <Link
          href="/orders/new"
          className="inline-flex h-10 items-center gap-2 bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-2"
        >
          <Plus className="h-4 w-4 stroke-[2.5]" />
          <span>New wholesale order</span>
        </Link>
      </header>

      {/* Today's figure + attention queue */}
      <OwnerAIBriefingCard briefing={ownerBriefing} />
      <DashboardAttentionConsole
        conversations={attentionConversations}
        orders={attentionOrders}
        returns={attentionReturns}
      />

      {/* Pipeline — plain counts in one ledger strip, not five boxed tiles */}
      <section className="border-b border-line py-5">
        <div className="flex items-baseline justify-between pb-3">
          <h2 className="font-display text-base font-semibold text-ink">Order pipeline</h2>
          <span className="text-xs text-text-muted font-tabular">
            {totalPipelineOrders} orders, {formatMoney(totalPipelineValue)}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 divide-x divide-line/70 border border-line">
          {pipelineOrder.map((status) => {
            const count = countByStatus[status] ?? 0;
            return (
              <Link
                key={status}
                href={`/orders?status=${status}`}
                className="px-4 py-3.5 hover:bg-surface transition-colors"
              >
                <p className="font-display text-2xl font-semibold font-tabular text-ink">{count}</p>
                <p className="mt-0.5 text-xs text-text-muted">{STATUS_SHORT_LABEL[status]}</p>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Stock risk forecast — only shown when something's actually at risk */}
      {ownerBriefing.stockoutRisks.length > 0 && (
        <section className="border-b border-line py-5">
          <div className="pb-1">
            <h2 className="font-display text-base font-semibold text-ink">Stock risk forecast</h2>
            <p className="text-xs text-text-muted">Based on confirmed sales over the last 7 days.</p>
          </div>
          <div className="divide-y divide-line/70">
            {ownerBriefing.stockoutRisks.map((risk) => (
              <Link
                key={risk.productId}
                href={`/catalogue/${risk.productId}`}
                className="group flex items-center justify-between gap-4 py-3 hover:bg-surface -mx-1 px-1 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-text-muted">{risk.sku}</span>
                    <span className={`text-xs font-semibold ${URGENCY_LABEL[risk.urgency]}`}>
                      {risk.urgency}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-ink truncate mt-0.5 group-hover:text-accent transition-colors">
                    {risk.name}
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">{risk.recommendation}</p>
                </div>
                <span className="shrink-0 font-tabular text-sm font-semibold text-ink">
                  {risk.available} left
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <DebtReminderDrafts debtors={ownerBriefing.debtDrafts} />

      {/* Recent orders & inbound messages */}
      <section className="grid gap-x-10 lg:grid-cols-2">
        <div className="min-w-0 py-5 border-b border-line lg:border-b-0">
          <div className="flex items-baseline justify-between pb-3">
            <h2 className="font-display text-base font-semibold text-ink">Recent orders</h2>
            <Link href="/orders" className="text-xs font-medium text-accent hover:text-accent-2">
              View all
            </Link>
          </div>

          {recentOrders.length === 0 ? (
            <p className="py-6 text-sm text-text-muted">No orders recorded yet.</p>
          ) : (
            <div className="divide-y divide-line/70">
              {recentOrders.map((o) => (
                <Link
                  key={o.id}
                  href={`/orders/${o.id}`}
                  className="group flex items-center justify-between gap-3 py-3 hover:bg-surface -mx-1 px-1 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-text-muted">{o.reference}</span>
                      <OrderStatusBadge status={o.status} />
                    </div>
                    <p className="text-sm font-medium text-ink truncate mt-0.5 group-hover:text-accent transition-colors">
                      {o.customer.name ?? o.customer.phone}
                    </p>
                  </div>
                  <span className="shrink-0 font-tabular text-sm font-semibold text-ink">
                    {formatMoney(o.totalCents, o.currency)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0 py-5">
          <div className="flex items-baseline justify-between pb-3">
            <h2 className="font-display text-base font-semibold text-ink">Inbound messages</h2>
            <Link href="/inbox" className="text-xs font-medium text-accent hover:text-accent-2">
              Open inbox
            </Link>
          </div>

          {recentMessages.length === 0 ? (
            <p className="py-6 text-sm text-text-muted">No messages yet.</p>
          ) : (
            <div className="divide-y divide-line/70">
              {recentMessages.map((m) => (
                <Link
                  key={m.id}
                  href={`/inbox/${m.conversationId}`}
                  className="group flex items-start justify-between gap-3 py-3 hover:bg-surface -mx-1 px-1 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ink group-hover:text-accent transition-colors truncate">
                        {m.conversation.customer.name ?? m.conversation.customer.phone}
                      </span>
                      <span className="text-xs text-text-muted">{m.sender === "CUSTOMER" ? "buyer" : "AI"}</span>
                    </div>
                    <p className="text-xs text-text-muted truncate mt-0.5 max-w-xs sm:max-w-sm">{m.body}</p>
                  </div>
                  <span className="shrink-0 font-tabular text-xs text-text-muted mt-0.5">
                    {formatRelativeTime(m.createdAt)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

const STATUS_SHORT_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  CONFIRMED: "Confirmed",
  PAID: "Paid",
  PARTIALLY_FULFILLED: "Partly shipped",
  FULFILLED: "Fulfilled",
};
