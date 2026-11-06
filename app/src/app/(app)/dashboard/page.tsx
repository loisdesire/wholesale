import Link from "next/link";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { formatMoney, formatRelativeTime } from "@/lib/format";
import { OrderStatusBadge } from "@/components/status-badge";
import { getOwnerAIBriefing } from "@/lib/owner-ai";
import { OwnerAIBriefingCard } from "@/components/owner-ai-briefing";
import { DashboardAttentionConsole } from "@/components/dashboard-attention-console";
import {
  ArrowRight,
  ChevronRight,
  Plus,
  ArrowUpRight,
  FileText,
  Lock,
  CreditCard,
  Truck,
  PackageCheck,
} from "lucide-react";

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
    <div className="flex flex-col gap-8 pb-14 max-w-7xl mx-auto">
      {/* 1. Clean Executive Header */}
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-line pb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-text-muted">
            <span className="font-mono uppercase tracking-wider text-accent font-bold">
              {organization?.name ?? "Wholesale Command"}
            </span>
            <span>·</span>
            <span>{today}</span>
          </div>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            {greeting}, {session!.user.name?.split(" ")[0]}
          </h1>
        </div>

        {/* Clean, Decisive Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href="/orders/new"
            className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-bold text-white shadow-xs shadow-accent/25 transition-all hover:bg-accent-2 hover:shadow-sm active:scale-95 cursor-pointer"
          >
            <Plus className="h-4 w-4 stroke-[2.5]" />
            <span>New Wholesale Order</span>
          </Link>

          <Link
            href="/operations"
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-line bg-surface px-4 py-2.5 text-xs font-semibold text-ink transition-colors hover:bg-paper active:scale-95 cursor-pointer shadow-2xs"
          >
            <span>Operations Desk</span>
            <ChevronRight className="h-3.5 w-3.5 text-text-muted" />
          </Link>
        </div>
      </header>

      {/* 2. Executive Financial Telemetry Strip */}
      <OwnerAIBriefingCard briefing={ownerBriefing} />

      {/* 3. Immediate Attention Console */}
      <DashboardAttentionConsole
        conversations={attentionConversations}
        orders={attentionOrders}
        returns={attentionReturns}
      />

      {/* 4. Connected Wholesale Fulfillment Conveyor */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="font-display text-base font-bold text-ink">Wholesale Fulfillment Conveyor</h2>
            <span className="rounded-full bg-paper border border-line px-2.5 py-0.5 text-xs font-semibold text-ink/80 font-tabular shadow-2xs">
              {totalPipelineOrders} active orders · {formatMoney(totalPipelineValue)} in transit
            </span>
          </div>
          <Link href="/orders" className="text-xs font-semibold text-accent hover:underline flex items-center gap-1 self-start sm:self-auto">
            <span>Open Order Ledger</span>
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="card-base overflow-hidden rounded-2xl border border-line shadow-xs">
          <div className="grid grid-cols-1 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-line/70">
            {pipelineOrder.map((status, idx) => {
              const count = countByStatus[status] ?? 0;
              const valueCents = valueByStatus[status] ?? 0;
              const isActive = count > 0;
              const Icon = STAGE_ICONS[status];

              return (
                <Link
                  key={status}
                  href={`/orders?status=${status}`}
                  className={`group relative p-4 sm:p-5 flex flex-col justify-between transition-all cursor-pointer ${
                    isActive
                      ? "bg-surface hover:bg-paper/50"
                      : "bg-paper/20 hover:bg-paper/40 opacity-75 hover:opacity-100"
                  }`}
                >
                  {/* Step Header: Step Number & Expressive Stage Pill */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-ink/40">
                      0{idx + 1}
                    </span>

                    <span
                      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold ${
                        isActive
                          ? STAGE_COLORS[status].badge
                          : "bg-paper text-ink/50 border border-line/60"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span>{STATUS_SHORT_LABEL[status]}</span>
                    </span>
                  </div>

                  {/* Volume Metric & Commercial Pipeline Value */}
                  <div className="my-4">
                    <div className="flex items-baseline gap-1.5">
                      <span
                        className={`font-display text-3xl font-bold tracking-tight ${
                          isActive
                            ? "text-ink group-hover:text-accent transition-colors"
                            : "text-ink/35"
                        }`}
                      >
                        {count}
                      </span>
                      <span className="text-xs text-ink/60 font-medium">
                        {count === 1 ? "order" : "orders"}
                      </span>
                    </div>

                    <p
                      className={`mt-1 font-tabular text-sm font-bold ${
                        isActive && valueCents > 0
                          ? "text-ink"
                          : "text-ink/35"
                      }`}
                    >
                      {valueCents > 0 ? formatMoney(valueCents) : "—"}
                    </p>
                  </div>

                  {/* Operational Subtitle & Directional Conveyor Link */}
                  <div className="border-t border-line/60 pt-2.5 flex items-center justify-between text-xs">
                    <span className="text-ink/70 truncate text-xs">
                      {STATUS_DESCRIPTION[status]}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-ink/30 group-hover:text-accent group-hover:translate-x-0.5 transition-all shrink-0 ml-1" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* 5. Dual Stream: Live Order Activity & WhatsApp Inbound Buyer Feed */}
      <section className="grid gap-6 lg:grid-cols-2">
        {/* Recent Wholesale Orders */}
        <div className="card-base p-6 flex flex-col justify-between shadow-xs rounded-2xl border border-line">
          <div>
            <div className="flex items-center justify-between border-b border-line pb-3.5 mb-3">
              <div>
                <h3 className="font-display text-sm font-bold text-ink">Recent Wholesale Orders</h3>
                <span className="text-xs text-text-muted">Real-time order entries</span>
              </div>
              <Link href="/orders" className="text-xs font-semibold text-accent hover:underline">
                View all orders →
              </Link>
            </div>

            {recentOrders.length === 0 ? (
              <p className="py-8 text-center text-xs text-ink/70">No recent orders recorded.</p>
            ) : (
              <div className="divide-y divide-line/60">
                {recentOrders.map((o) => {
                  const customerName = o.customer.name ?? o.customer.phone;
                  const initials = (o.customer.name ?? "W")
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase();

                  return (
                    <Link
                      key={o.id}
                      href={`/orders/${o.id}`}
                      className="group -mx-2 flex items-center justify-between gap-3 rounded-xl p-2.5 transition-colors hover:bg-paper/60"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Customer Avatar Circle */}
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 font-display text-xs font-bold text-accent group-hover:bg-accent group-hover:text-white transition-colors">
                          {initials}
                        </div>

                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-ink group-hover:text-accent transition-colors">
                              {o.reference}
                            </span>
                            <OrderStatusBadge status={o.status} />
                          </div>
                          <span className="text-xs font-medium text-ink/75 truncate mt-0.5">
                            {customerName}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-tabular text-sm font-bold text-ink">
                          {formatMoney(o.totalCents, o.currency)}
                        </span>
                        <ArrowUpRight className="h-3.5 w-3.5 text-ink/50 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Live Inbound WhatsApp Feed */}
        <div className="card-base p-6 flex flex-col justify-between shadow-xs rounded-2xl border border-line">
          <div>
            <div className="flex items-center justify-between border-b border-line pb-3.5 mb-3">
              <div>
                <h3 className="font-display text-sm font-bold text-ink">Inbound WhatsApp Feed</h3>
                <span className="text-xs text-text-muted">Live customer requests &amp; inquiries</span>
              </div>
              <Link href="/inbox" className="text-xs font-semibold text-accent hover:underline">
                Open Inbox →
              </Link>
            </div>

            {recentMessages.length === 0 ? (
              <p className="py-8 text-center text-xs text-ink/70">No incoming messages recorded.</p>
            ) : (
              <div className="divide-y divide-line/60">
                {recentMessages.map((m) => {
                  const customerName = m.conversation.customer.name ?? m.conversation.customer.phone;
                  const initials = (m.conversation.customer.name ?? "C")
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase();

                  return (
                    <Link
                      key={m.id}
                      href={`/inbox/${m.conversationId}`}
                      className="group -mx-2 flex items-start justify-between gap-3 rounded-xl p-2.5 transition-colors hover:bg-paper/60"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        {/* Customer Avatar Circle */}
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 font-display text-xs font-bold text-amber-900 group-hover:bg-amber-600 group-hover:text-white transition-colors">
                          {initials}
                        </div>

                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-ink group-hover:text-accent transition-colors truncate">
                              {customerName}
                            </span>
                            <span className="font-mono text-[10px] uppercase font-bold text-ink/60 bg-paper px-1.5 py-0.2 rounded border border-line/60">
                              {m.sender === "CUSTOMER" ? "Buyer" : "AI"}
                            </span>
                          </div>
                          <p className="text-xs font-normal text-ink/85 truncate mt-0.5 max-w-xs sm:max-w-sm">
                            {m.body}
                          </p>
                        </div>
                      </div>

                      <span className="font-tabular text-[11px] font-semibold text-text-muted shrink-0 mt-0.5">
                        {formatRelativeTime(m.createdAt)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

const STATUS_SHORT_LABEL: Record<string, string> = {
  DRAFT: "Draft Quotes",
  CONFIRMED: "Confirmed",
  PAID: "Settled & Paid",
  PARTIALLY_FULFILLED: "Partly Shipped",
  FULFILLED: "Completed",
};

const STATUS_DESCRIPTION: Record<string, string> = {
  DRAFT: "Awaiting quote review",
  CONFIRMED: "Stock locked, awaiting transfer",
  PAID: "Payment verified, ready to pack",
  PARTIALLY_FULFILLED: "Partial shipments out",
  FULFILLED: "All items dispatched",
};

const STAGE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  DRAFT: FileText,
  CONFIRMED: Lock,
  PAID: CreditCard,
  PARTIALLY_FULFILLED: Truck,
  FULFILLED: PackageCheck,
};

const STAGE_COLORS: Record<string, { badge: string }> = {
  DRAFT: {
    badge: "bg-paper text-ink/80 border border-line",
  },
  CONFIRMED: {
    badge: "bg-accent/10 text-accent border border-accent/25",
  },
  PAID: {
    badge: "bg-emerald-500/10 text-emerald-800 border border-emerald-500/25",
  },
  PARTIALLY_FULFILLED: {
    badge: "bg-amber-500/10 text-amber-900 border border-amber-500/25",
  },
  FULFILLED: {
    badge: "bg-emerald-500/10 text-emerald-800 border border-emerald-500/25",
  },
};
