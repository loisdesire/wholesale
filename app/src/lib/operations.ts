import { OrderStatus, ReturnKind, ReturnStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tenantDb, transaction } from "@/lib/db";
import { HOUR_MS, SEVERITY_RANK, resolveSla, type Severity } from "@/lib/ops-config";
import { getStockByProduct } from "@/lib/stock";
import { formatMoney } from "@/lib/format";
import { dateInput } from "@/lib/reports";

/** The organization's resolved SLA thresholds (its overrides merged onto the defaults). */
async function orgSla(organizationId: string) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { slaOverrides: true } });
  return resolveSla(org.slaOverrides);
}

/** "3h", "2 days" — how long something has been waiting. */
export function formatAge(hours: number) {
  if (hours < 1) return "under an hour";
  if (hours < 48) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)} days`;
}

export type AttentionItem = {
  key: string;
  kind: "order" | "return" | "conversation";
  id: string;
  severity: Severity;
  /** Every rule this record trips, most severe first. */
  reasons: string[];
  reference: string;
  customer: string | null;
  ageHours: number;
  href: string;
  amountCents: number | null;
  assignee: { id: string; name: string } | null;
};

const OPEN_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.DRAFT,
  OrderStatus.CONFIRMED,
  OrderStatus.PAID,
  OrderStatus.PARTIALLY_FULFILLED,
];

const PER_RULE_CAP = 100;

export type AttentionResult = {
  items: AttentionItem[];
  /** True if any one rule hit PER_RULE_CAP — some overdue records may not be shown. */
  truncated: boolean;
};

/**
 * Everything that needs a person right now, most urgent first. Each record appears
 * once, with every reason it is on the list (a confirmed order can be both
 * unpaid-for-days and past its due date). Thresholds live in ops-config.ts.
 *
 * Each rule is capped at PER_RULE_CAP so one runaway backlog can't make this query
 * unbounded; `truncated` says whether that cap was actually hit by any rule, so the
 * page can say so rather than silently showing an incomplete list as if it were whole.
 */
export async function getAttentionItems(organizationId: string, now = new Date()): Promise<AttentionResult> {
  const db = tenantDb(organizationId);
  const sla = await orgSla(organizationId);
  const ago = (h: number) => new Date(now.getTime() - h * HOUR_MS);
  const hoursSince = (d: Date) => (now.getTime() - d.getTime()) / HOUR_MS;
  const assigneeSelect = { select: { id: true, name: true } } as const;

  const items = new Map<string, AttentionItem>();
  const add = (
    base: Omit<AttentionItem, "reasons" | "severity"> & { severity: Severity; reason: string }
  ) => {
    const { reason, severity, ...rest } = base;
    const existing = items.get(base.key);
    if (!existing) {
      items.set(base.key, { ...rest, severity, reasons: [reason] });
      return;
    }
    // A more severe rule's reason leads; otherwise reasons read in the order they were added.
    const upgraded = SEVERITY_RANK[severity] < SEVERITY_RANK[existing.severity];
    existing.reasons = upgraded ? [reason, ...existing.reasons] : [...existing.reasons, reason];
    if (upgraded) existing.severity = severity;
    existing.ageHours = Math.max(existing.ageHours, rest.ageHours);
  };

  const [conversations, drafts, unpaid, unshipped, partial, pastDue, returnsWaiting, returnsToReceive, refundsToPay] =
    await Promise.all([
      db.conversation.findMany({
        where: { organizationId, status: { in: ["NEW", "AWAITING_STAFF"] }, lastMessageAt: { lt: ago(sla.conversationWaitingWarnHours) } },
        include: { customer: true, assignedTo: assigneeSelect },
        orderBy: { lastMessageAt: "asc" },
        take: PER_RULE_CAP,
      }),
      db.order.findMany({
        where: { organizationId, status: "DRAFT", createdAt: { lt: ago(sla.draftStaleWarnHours) } },
        include: { customer: true, assignedTo: assigneeSelect },
        orderBy: { createdAt: "asc" },
        take: PER_RULE_CAP,
      }),
      db.order.findMany({
        where: { organizationId, status: "CONFIRMED", confirmedAt: { lt: ago(sla.paymentOverdueWarnHours) } },
        include: { customer: true, assignedTo: assigneeSelect },
        orderBy: { confirmedAt: "asc" },
        take: PER_RULE_CAP,
      }),
      db.order.findMany({
        where: { organizationId, status: "PAID", paidAt: { lt: ago(sla.shipOverdueWarnHours) } },
        include: { customer: true, assignedTo: assigneeSelect },
        orderBy: { paidAt: "asc" },
        take: PER_RULE_CAP,
      }),
      db.order.findMany({
        where: { organizationId, status: "PARTIALLY_FULFILLED" },
        include: { customer: true, assignedTo: assigneeSelect, shipments: { orderBy: { createdAt: "desc" }, take: 1 } },
        take: PER_RULE_CAP,
      }),
      db.order.findMany({
        where: { organizationId, status: { in: OPEN_ORDER_STATUSES }, dueAt: { lt: now } },
        include: { customer: true, assignedTo: assigneeSelect },
        orderBy: { dueAt: "asc" },
        take: PER_RULE_CAP,
      }),
      db.orderReturn.findMany({
        where: { organizationId, status: "REQUESTED", createdAt: { lt: ago(sla.returnDecisionWarnHours) } },
        include: { customer: true, order: true, assignedTo: assigneeSelect },
        orderBy: { createdAt: "asc" },
        take: PER_RULE_CAP,
      }),
      db.orderReturn.findMany({
        where: { organizationId, status: "APPROVED", kind: "RETURN", decidedAt: { lt: ago(sla.returnReceiveWarnHours) } },
        include: { customer: true, order: true, assignedTo: assigneeSelect },
        orderBy: { decidedAt: "asc" },
        take: PER_RULE_CAP,
      }),
      db.orderReturn.findMany({
        where: { organizationId, refundStatus: "PENDING", decidedAt: { lt: ago(sla.refundPayWarnHours) } },
        include: { customer: true, order: true, assignedTo: assigneeSelect },
        orderBy: { decidedAt: "asc" },
        take: PER_RULE_CAP,
      }),
    ]);

  const who = (c: { name: string | null; phone: string }) => c.name ?? c.phone;
  const orderBase = (o: (typeof drafts)[number], ageFrom: Date) => ({
    key: `order:${o.id}`,
    kind: "order" as const,
    id: o.id,
    reference: o.reference,
    customer: who(o.customer),
    ageHours: hoursSince(ageFrom),
    href: `/orders/${o.id}`,
    amountCents: o.totalCents,
    assignee: o.assignedTo,
  });
  const returnBase = (r: (typeof returnsWaiting)[number], ageFrom: Date) => ({
    key: `return:${r.id}`,
    kind: "return" as const,
    id: r.id,
    reference: r.reference,
    customer: who(r.customer),
    ageHours: hoursSince(ageFrom),
    href: `/orders/${r.orderId}`,
    amountCents: r.refundCents,
    assignee: r.assignedTo,
  });
  const tiered = (hours: number, critical: number): Severity => (hours >= critical ? "critical" : "warning");

  for (const c of conversations) {
    const h = hoursSince(c.lastMessageAt);
    add({
      key: `conversation:${c.id}`,
      kind: "conversation",
      id: c.id,
      reference: who(c.customer),
      // Unlike an order or return, a conversation's "reference" already *is* the
      // customer's name — showing it again as `customer` would just repeat it.
      customer: null,
      ageHours: h,
      href: `/inbox/${c.id}`,
      amountCents: null,
      assignee: c.assignedTo,
      severity: tiered(h, sla.conversationWaitingCriticalHours),
      reason: `Customer has been waiting ${formatAge(h)} for a reply`,
    });
  }
  for (const o of drafts) {
    add({ ...orderBase(o, o.createdAt), severity: "info", reason: `Draft not confirmed after ${formatAge(hoursSince(o.createdAt))}` });
  }
  for (const o of unpaid) {
    const h = hoursSince(o.confirmedAt ?? o.createdAt);
    add({ ...orderBase(o, o.confirmedAt ?? o.createdAt), severity: tiered(h, sla.paymentOverdueCriticalHours), reason: `Payment overdue — confirmed ${formatAge(h)} ago` });
  }
  for (const o of unshipped) {
    const h = hoursSince(o.paidAt ?? o.createdAt);
    add({ ...orderBase(o, o.paidAt ?? o.createdAt), severity: tiered(h, sla.shipOverdueCriticalHours), reason: `Paid ${formatAge(h)} ago and not shipped` });
  }
  for (const o of partial) {
    const last = o.shipments[0]?.createdAt ?? o.paidAt ?? o.createdAt;
    const h = hoursSince(last);
    if (h >= sla.partialStaleWarnHours) {
      add({ ...orderBase(o, last), severity: "warning", reason: `Part-shipped and nothing new has gone out for ${formatAge(h)}` });
    }
  }
  for (const o of pastDue) {
    add({ ...orderBase(o, o.dueAt!), severity: "critical", reason: `Past its due date by ${formatAge(hoursSince(o.dueAt!))}` });
  }
  for (const r of returnsWaiting) {
    const h = hoursSince(r.createdAt);
    add({ ...returnBase(r, r.createdAt), severity: tiered(h, sla.returnDecisionCriticalHours), reason: `Return waiting ${formatAge(h)} for the owner's decision` });
  }
  for (const r of returnsToReceive) {
    const h = hoursSince(r.decidedAt!);
    add({ ...returnBase(r, r.decidedAt!), severity: "warning", reason: `Approved ${formatAge(h)} ago but the goods haven't been booked in` });
  }
  for (const r of refundsToPay) {
    const h = hoursSince(r.decidedAt!);
    add({ ...returnBase(r, r.decidedAt!), severity: tiered(h, sla.refundPayCriticalHours), reason: `Refund approved ${formatAge(h)} ago and still unpaid` });
  }

  const truncated = [conversations, drafts, unpaid, unshipped, partial, pastDue, returnsWaiting, returnsToReceive, refundsToPay].some(
    (rows) => rows.length === PER_RULE_CAP
  );
  return {
    items: [...items.values()].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.ageHours - a.ageHours),
    truncated,
  };
}

export type Metric = {
  key: string;
  label: string;
  /** What to show — already formatted ("4h 20m", "12%", "3 of 12"). */
  value: string;
  /** The number behind it, or null when there's nothing to measure yet. */
  raw: number | null;
  /** The sentence that says exactly what was counted. */
  detail: string;
  /** The records behind the number. */
  href?: string;
};

export type WorkloadRow = {
  userId: string;
  name: string;
  role: string;
  openOrders: number;
  openReturns: number;
  openConversations: number;
};

function formatDuration(hours: number) {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${Math.floor(hours)}h ${Math.round((hours % 1) * 60)}m`;
  return `${(hours / 24).toFixed(1)} days`;
}

const percent = (part: number, whole: number) => (whole === 0 ? null : (part / whole) * 100);

/**
 * Operating metrics for a period, each computed from the underlying records and each
 * saying precisely what it counted and where to look at those records. Where there is
 * nothing to measure (no orders, no AI traffic yet) the value is "—", never a made-up
 * zero or a flattering default.
 */
export async function getOperationalMetrics(
  organizationId: string,
  range: { from: Date; to: Date },
  now = new Date()
): Promise<{ metrics: Metric[]; attentionCounts: Record<Severity, number>; attentionTruncated: boolean; workload: WorkloadRow[] }> {
  const db = tenantDb(organizationId);
  const { from, to } = range;
  const inRange = { gte: from, lte: to };
  const period = `from=${dateInput(from)}&to=${dateInput(to)}`;

  const [
    created,
    cancelled,
    fulfilledCount,
    fulfilledWithReturn,
    refundAgg,
    paidAgg,
    medians,
    attention,
  ] = await Promise.all([
    db.order.count({ where: { organizationId, createdAt: inRange } }),
    db.order.count({ where: { organizationId, createdAt: inRange, status: "CANCELLED" } }),
    db.order.count({ where: { organizationId, fulfilledAt: inRange } }),
    db.order.count({
      where: { organizationId, fulfilledAt: inRange, returns: { some: { kind: ReturnKind.RETURN, status: { not: ReturnStatus.REJECTED } } } },
    }),
    db.orderReturn.aggregate({
      where: { organizationId, createdAt: inRange, status: { not: ReturnStatus.REJECTED } },
      _sum: { refundCents: true },
      _count: true,
    }),
    db.order.aggregate({ where: { organizationId, paidAt: inRange }, _sum: { totalCents: true } }),
    transaction(organizationId, async (tx) => {
      const [fulfil] = await tx.$queryRaw<{ m: number | null; n: bigint }[]>`
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("fulfilledAt" - "paidAt")) / 3600) AS m, count(*) AS n
          FROM "Order"
         WHERE "organizationId" = ${organizationId} AND "fulfilledAt" BETWEEN ${from} AND ${to} AND "paidAt" IS NOT NULL`;
      const [pay] = await tx.$queryRaw<{ m: number | null; n: bigint }[]>`
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("paidAt" - "confirmedAt")) / 3600) AS m, count(*) AS n
          FROM "Order"
         WHERE "organizationId" = ${organizationId} AND "paidAt" BETWEEN ${from} AND ${to} AND "confirmedAt" IS NOT NULL`;
      const [response] = await tx.$queryRaw<{ m: number | null; answered: bigint; unanswered: bigint }[]>`
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.first_out - t.first_in)) / 60)
                 FILTER (WHERE t.first_out >= t.first_in) AS m,
               count(*) FILTER (WHERE t.first_out >= t.first_in) AS answered,
               count(*) FILTER (WHERE t.first_in IS NOT NULL AND (t.first_out IS NULL OR t.first_out < t.first_in)) AS unanswered
          FROM (SELECT c."id",
                       MIN(m."createdAt") FILTER (WHERE m."direction" = 'INBOUND') AS first_in,
                       MIN(m."createdAt") FILTER (WHERE m."direction" = 'OUTBOUND') AS first_out
                  FROM "Conversation" c JOIN "Message" m ON m."conversationId" = c."id"
                 WHERE c."organizationId" = ${organizationId} AND c."createdAt" BETWEEN ${from} AND ${to}
                 GROUP BY c."id") t`;
      const [ai] = await tx.$queryRaw<{ handled: bigint; escalated: bigint }[]>`
        SELECT count(*) AS handled,
               count(*) FILTER (WHERE t.status = 'AWAITING_STAFF' OR t.staff_replies > 0) AS escalated
          FROM (SELECT c."id", c."status",
                       count(*) FILTER (WHERE m."sender" = 'STAFF') AS staff_replies,
                       count(*) FILTER (WHERE m."sender" = 'AI') AS ai_replies
                  FROM "Conversation" c JOIN "Message" m ON m."conversationId" = c."id"
                 WHERE c."organizationId" = ${organizationId} AND c."createdAt" BETWEEN ${from} AND ${to}
                 GROUP BY c."id", c."status") t
         WHERE t.ai_replies > 0`;
      return { fulfil, pay, response, ai };
    }),
    getAttentionItems(organizationId, now),
  ]);

  const attentionCounts: Record<Severity, number> = { critical: 0, warning: 0, info: 0 };
  for (const item of attention.items) attentionCounts[item.severity] += 1;

  const refundCents = refundAgg._sum.refundCents ?? 0;
  const paidCents = paidAgg._sum.totalCents ?? 0;
  const answered = Number(medians.response?.answered ?? 0);
  const unanswered = Number(medians.response?.unanswered ?? 0);
  const aiHandled = Number(medians.ai?.handled ?? 0);
  const aiEscalated = Number(medians.ai?.escalated ?? 0);
  const fulfilN = Number(medians.fulfil?.n ?? 0);
  const payN = Number(medians.pay?.n ?? 0);

  const cancelRate = percent(cancelled, created);
  const returnRate = percent(fulfilledWithReturn, fulfilledCount);
  const refundRate = percent(refundCents, paidCents);

  const metrics: Metric[] = [
    {
      key: "overdue",
      label: "Overdue now",
      value: String(attentionCounts.critical + attentionCounts.warning),
      raw: attentionCounts.critical + attentionCounts.warning,
      detail: `${attentionCounts.critical} critical and ${attentionCounts.warning} warning items past their allowed wait (right now, not just this period).${
        attention.truncated ? " At least one category has more than can be shown here — narrow it down below." : ""
      }`,
      href: "/operations#attention",
    },
    {
      key: "orders",
      label: "Orders created",
      value: String(created),
      raw: created,
      detail: `${created} order${created === 1 ? "" : "s"} created in this period; ${fulfilledCount} fulfilled.`,
      href: `/orders?${period}`,
    },
    {
      key: "fulfilment",
      label: "Time to ship after payment",
      value: fulfilN === 0 || medians.fulfil?.m == null ? "—" : formatDuration(medians.fulfil.m),
      raw: medians.fulfil?.m ?? null,
      detail: fulfilN === 0 ? "No orders were fulfilled in this period." : `Median over ${fulfilN} order${fulfilN === 1 ? "" : "s"} fulfilled in the period (paid → fully shipped).`,
      href: `/orders?status=FULFILLED&${period}`,
    },
    {
      key: "payment",
      label: "Time to payment after confirmation",
      value: payN === 0 || medians.pay?.m == null ? "—" : formatDuration(medians.pay.m),
      raw: medians.pay?.m ?? null,
      detail: payN === 0 ? "No orders were marked paid in this period." : `Median over ${payN} order${payN === 1 ? "" : "s"} paid in the period (confirmed → marked paid).`,
      href: `/orders?status=PAID&${period}`,
    },
    {
      key: "response",
      label: "First response time",
      value: answered === 0 || medians.response?.m == null ? "—" : formatDuration(medians.response.m / 60),
      raw: medians.response?.m != null ? medians.response.m / 60 : null,
      detail:
        answered + unanswered === 0
          ? "No conversations started in this period."
          : `Median over ${answered} answered conversation${answered === 1 ? "" : "s"}; ${unanswered} started in the period ${unanswered === 1 ? "has" : "have"} no reply yet.`,
      href: "/inbox",
    },
    {
      key: "cancellation",
      label: "Cancellation rate",
      value: cancelRate === null ? "—" : `${cancelRate.toFixed(0)}%`,
      raw: cancelRate,
      detail: created === 0 ? "No orders created in this period." : `${cancelled} of the ${created} orders created in this period were cancelled.`,
      href: `/orders?status=CANCELLED&${period}`,
    },
    {
      key: "returns",
      label: "Return rate",
      value: returnRate === null ? "—" : `${returnRate.toFixed(0)}%`,
      raw: returnRate,
      detail: fulfilledCount === 0 ? "No orders were fulfilled in this period." : `${fulfilledWithReturn} of the ${fulfilledCount} orders fulfilled in this period have a return against them.`,
      href: `/returns?${period}`,
    },
    {
      key: "refunds",
      label: "Refunds as a share of cash paid",
      value: refundRate === null ? "—" : `${refundRate.toFixed(1)}%`,
      raw: refundRate,
      detail:
        paidCents === 0
          ? "No orders were paid in this period."
          : `${formatMoney(refundCents)} refunded or owed (${refundAgg._count} request${refundAgg._count === 1 ? "" : "s"}) against ${formatMoney(paidCents)} of orders paid in the period.`,
      href: `/returns?${period}`,
    },
    {
      key: "escalation",
      label: "AI conversations needing a person",
      value: aiHandled === 0 ? "—" : `${aiEscalated} of ${aiHandled}`,
      raw: aiHandled === 0 ? null : (aiEscalated / aiHandled) * 100,
      detail:
        aiHandled === 0
          ? "No conversations in this period involved an AI reply."
          : `${aiEscalated} of ${aiHandled} conversations where the AI replied were handed to staff.`,
      href: "/inbox",
    },
  ];

  const [memberships, openOrdersBy, openReturnsBy, openConversationsBy] = await Promise.all([
    prisma.membership.findMany({ where: { organizationId }, include: { user: true }, orderBy: { createdAt: "asc" } }),
    db.order.groupBy({
      by: ["assignedToId"],
      where: { organizationId, assignedToId: { not: null }, status: { in: OPEN_ORDER_STATUSES } },
      _count: true,
    }),
    db.orderReturn.groupBy({
      by: ["assignedToId"],
      where: {
        organizationId,
        assignedToId: { not: null },
        OR: [{ status: { in: ["REQUESTED", "APPROVED"] } }, { refundStatus: "PENDING" }],
      },
      _count: true,
    }),
    db.conversation.groupBy({
      by: ["assignedToId"],
      where: { organizationId, assignedToId: { not: null }, status: { not: "RESOLVED" } },
      _count: true,
    }),
  ]);
  const countFor = (rows: { assignedToId: string | null; _count: number }[], id: string) =>
    rows.find((r) => r.assignedToId === id)?._count ?? 0;
  const workload: WorkloadRow[] = memberships.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    role: m.role,
    openOrders: countFor(openOrdersBy, m.userId),
    openReturns: countFor(openReturnsBy, m.userId),
    openConversations: countFor(openConversationsBy, m.userId),
  }));

  return { metrics, attentionCounts, attentionTruncated: attention.truncated, workload };
}

/** Active products with nothing left to sell — shown as a heads-up on the control room. */
export async function getOutOfStockProducts(organizationId: string) {
  const db = tenantDb(organizationId);
  const [products, stock] = await Promise.all([
    db.product.findMany({ where: { organizationId, active: true }, select: { id: true, name: true, sku: true }, orderBy: { name: "asc" } }),
    getStockByProduct(organizationId, db),
  ]);
  return products.filter((p) => (stock.get(p.id) ?? 0) <= 0);
}
