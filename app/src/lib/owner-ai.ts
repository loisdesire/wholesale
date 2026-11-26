import { tenantDb } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { getOutstandingBalances } from "@/lib/reports";
import { getAttentionItems } from "@/lib/operations";
import { getStockBreakdownByProduct } from "@/lib/stock";

export type StockoutRisk = {
  productId: string;
  sku: string;
  name: string;
  /** Colour/size etc., so two variants of one product are told apart ("M / Black"). */
  variant: string | null;
  available: number;
  physical: number;
  reserved: number;
  dailyVelocity: number;
  daysRemaining: number;
  urgency: "CRITICAL" | "WARNING" | "WATCH";
  recommendation: string;
};

export type DebtReminderDraft = {
  customerId: string;
  customerName: string;
  phone: string;
  owesCents: number;
  tones: {
    respectful: string;
    firm: string;
    pidgin: string;
  };
};

export type OwnerAIBriefing = {
  executiveHeadline: string;
  summaryParagraph: string;
  metrics: {
    todayCashCents: number;
    weekCashCents: number;
    totalReceivablesCents: number;
    pendingRefundsCents: number;
    activeWhatsAppChats24h: number;
  };
  criticalAlerts: {
    id: string;
    type: "DEBT" | "STOCKOUT" | "REFUND" | "BOTTLENECK";
    title: string;
    detail: string;
    impact: string;
    actionLabel: string;
    actionHref: string;
    severity: "HIGH" | "MEDIUM" | "LOW";
  }[];
  stockoutRisks: StockoutRisk[];
  debtDrafts: DebtReminderDraft[];
};

export async function getOwnerAIBriefing(organizationId: string): Promise<OwnerAIBriefing> {
  const db = tenantDb(organizationId);
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    org,
    todayCash,
    weekCash,
    outstandingList,
    attentionResult,
    allProducts,
    stockMap,
    recentOrderItems,
    recentChatsCount,
  ] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    }),
    db.payment.aggregate({
      where: {
        organizationId,
        createdAt: { gte: oneDayAgo },
      },
      _sum: { amountCents: true },
    }),
    db.payment.aggregate({
      where: {
        organizationId,
        createdAt: { gte: sevenDaysAgo },
      },
      _sum: { amountCents: true },
    }),
    getOutstandingBalances(organizationId),
    getAttentionItems(organizationId),
    db.product.findMany({
      where: { organizationId, active: true },
      select: { id: true, sku: true, name: true, variantAttributes: true },
      orderBy: { name: "asc" },
      take: 300,
    }),
    getStockBreakdownByProduct(organizationId, {}, db),
    db.orderItem.groupBy({
      by: ["productId"],
      where: {
        order: {
          organizationId,
          confirmedAt: { gte: sevenDaysAgo },
          status: { in: ["CONFIRMED", "PAID", "PARTIALLY_FULFILLED", "FULFILLED"] },
        },
      },
      _sum: { quantity: true },
    }),
    db.conversation.count({
      where: {
        organizationId,
        lastMessageAt: { gte: oneDayAgo },
      },
    }),
  ]);

  const todayCashCents = todayCash._sum.amountCents ?? 0;
  const weekCashCents = weekCash._sum.amountCents ?? 0;
  const totalReceivablesCents = outstandingList.reduce((acc, row) => acc + row.owesUsCents, 0);
  const pendingRefundsCents = outstandingList.reduce((acc, row) => acc + row.weOweCents, 0);

  // Velocity & Stockout Risk Analysis
  const demandMap = new Map<string, number>();
  for (const item of recentOrderItems) {
    demandMap.set(item.productId, item._sum.quantity ?? 0);
  }

  const stockoutRisks: StockoutRisk[] = [];
  for (const p of allProducts) {
    const figures = stockMap.get(p.id) ?? { physical: 0, reserved: 0, damaged: 0, available: 0 };
    const available = Math.max(0, figures.available);
    const sevenDayUnits = demandMap.get(p.id) ?? 0;
    // Only real sales count: a product nobody bought this week has no "sales speed", and inventing
    // one made the dashboard claim demand that did not exist.
    const hasSales = sevenDayUnits > 0;
    const dailyVelocity = hasSales ? Number((sevenDayUnits / 7).toFixed(1)) : 0;
    const daysRemaining = hasSales ? Math.round(available / dailyVelocity) : 999;

    if (available === 0 || (hasSales && daysRemaining < 14) || (!hasSales && available <= 3)) {
      const urgency = available === 0 || daysRemaining <= 3 ? "CRITICAL" : daysRemaining <= 7 ? "WARNING" : "WATCH";
      const recommendation =
        available === 0
          ? "Out of stock. Restock to keep selling."
          : hasSales
            ? `Selling about ${dailyVelocity} a day, so roughly ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} of stock left.`
            : "Only a few left. No sales in the last 7 days.";
      const attrs = p.variantAttributes && typeof p.variantAttributes === "object" && !Array.isArray(p.variantAttributes) ? Object.values(p.variantAttributes as Record<string, unknown>).map(String) : [];

      stockoutRisks.push({
        productId: p.id,
        sku: p.sku,
        name: p.name,
        variant: attrs.length > 0 ? attrs.join(" / ") : null,
        available,
        physical: figures.physical,
        reserved: figures.reserved,
        dailyVelocity,
        daysRemaining,
        urgency,
        recommendation,
      });
    }
  }

  // Sort risks: CRITICAL first, then lowest daysRemaining
  stockoutRisks.sort((a, b) => {
    if (a.urgency === "CRITICAL" && b.urgency !== "CRITICAL") return -1;
    if (b.urgency === "CRITICAL" && a.urgency !== "CRITICAL") return 1;
    return a.daysRemaining - b.daysRemaining;
  });

  // Debt Reminder Drafts
  const topDebtors = outstandingList.filter((d) => d.owesUsCents > 0).slice(0, 5);
  const orgName = org?.name ?? "us";

  const debtDrafts: DebtReminderDraft[] = topDebtors.map((debtor) => {
    const formatted = formatMoney(debtor.owesUsCents);
    return {
      customerId: debtor.customerId,
      customerName: debtor.name,
      phone: debtor.phone,
      owesCents: debtor.owesUsCents,
      tones: {
        respectful: `Good day ${debtor.name}, thank you for your support. A gentle reminder that ${formatted} is still unpaid on your account with ${orgName}. Please let us know when you plan to pay. Thank you!`,
        firm: `Hello ${debtor.name}, your balance of ${formatted} with ${orgName} is still unpaid. Please settle it today so we can keep your next order moving. Thank you.`,
        pidgin: `Good morning ${debtor.name}! Small reminder say your ${formatted} balance with ${orgName} never clear o. Abeg send am when you fit so we fit prepare your next order. Thank you!`,
      },
    };
  });

  // Critical Alerts Synthesis
  const criticalAlerts: OwnerAIBriefing["criticalAlerts"] = [];

  if (totalReceivablesCents > 0) {
    criticalAlerts.push({
      id: "alert-receivables",
      type: "DEBT",
      title: `${formatMoney(totalReceivablesCents)} still unpaid`,
      detail: topDebtors.length === 1 ? "1 customer owes you money." : `${topDebtors.length} customers owe you money.`,
      impact: "Money you are waiting on.",
      actionLabel: "Send reminders",
      actionHref: "/customers?filter=owes",
      severity: totalReceivablesCents > 1_000_000 ? "HIGH" : "MEDIUM",
    });
  }

  if (stockoutRisks.some((r) => r.urgency === "CRITICAL")) {
    const critCount = stockoutRisks.filter((r) => r.urgency === "CRITICAL").length;
    criticalAlerts.push({
      id: "alert-stockout",
      type: "STOCKOUT",
      title: critCount === 1 ? "1 item is about to run out" : `${critCount} items are about to run out`,
      detail: `${stockoutRisks[0].name}${stockoutRisks[0].variant ? ` (${stockoutRisks[0].variant})` : ""} has ${stockoutRisks[0].available} left.`,
      impact: "You may lose sales until it is restocked.",
      actionLabel: "Check stock",
      actionHref: "/catalogue",
      severity: "HIGH",
    });
  }

  const pendingReturns = attentionResult.items.filter((i) => i.kind === "return");
  if (pendingReturns.length > 0) {
    criticalAlerts.push({
      id: "alert-returns",
      type: "REFUND",
      title: pendingReturns.length === 1 ? "1 return is waiting for your decision" : `${pendingReturns.length} returns are waiting for your decision`,
      detail: "A return needs an owner to approve it before the goods go back on the shelf.",
      impact: "The customer is waiting for their refund or credit.",
      actionLabel: "Review returns",
      actionHref: "/returns?status=REQUESTED",
      severity: "MEDIUM",
    });
  }

  // Summary generation
  const debtorHighlight =
    topDebtors.length > 0
      ? `${formatMoney(totalReceivablesCents)} is still unpaid, across ${topDebtors.length} customer${topDebtors.length === 1 ? "" : "s"}.`
      : "No customer owes you anything right now.";

  const stockHighlight =
    stockoutRisks.length > 0
      ? `${stockoutRisks.length} product${stockoutRisks.length === 1 ? " is" : "s are"} running low.`
      : "Stock levels look healthy.";

  const executiveHeadline =
    todayCashCents > 0
      ? `${formatMoney(todayCashCents)} collected today · ${recentChatsCount} active chat${recentChatsCount === 1 ? "" : "s"}`
      : `${recentChatsCount} active chat${recentChatsCount === 1 ? "" : "s"} · ${topDebtors.length} customer${topDebtors.length === 1 ? "" : "s"} owing`;

  const summaryParagraph = `In the last 24 hours: ${recentChatsCount} active chat${recentChatsCount === 1 ? "" : "s"} and ${formatMoney(todayCashCents)} collected (${formatMoney(weekCashCents)} over 7 days). ${debtorHighlight} ${stockHighlight}`;

  return {
    executiveHeadline,
    summaryParagraph,
    metrics: {
      todayCashCents,
      weekCashCents,
      totalReceivablesCents,
      pendingRefundsCents,
      activeWhatsAppChats24h: recentChatsCount,
    },
    criticalAlerts,
    stockoutRisks: stockoutRisks.slice(0, 5),
    debtDrafts,
  };
}
