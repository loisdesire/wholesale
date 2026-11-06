import { tenantDb } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { getOutstandingBalances } from "@/lib/reports";
import { getAttentionItems } from "@/lib/operations";
import { getStockBreakdownByProduct } from "@/lib/stock";

export type StockoutRisk = {
  productId: string;
  sku: string;
  name: string;
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
      select: { id: true, sku: true, name: true },
      take: 20,
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
    // Daily run-rate (minimum 0.5 units/day for active catalogue baseline)
    const dailyVelocity = sevenDayUnits > 0 ? Number((sevenDayUnits / 7).toFixed(1)) : 0.8;
    const daysRemaining = dailyVelocity > 0 ? Math.round(available / dailyVelocity) : 99;

    if (available === 0 || daysRemaining < 14) {
      const urgency = available === 0 || daysRemaining <= 3 ? "CRITICAL" : daysRemaining <= 7 ? "WARNING" : "WATCH";
      const recommendation =
        available === 0
          ? "Warehouse stock depleted! Replenish immediately before competitors capture buyers."
          : `At current sales speed of ${dailyVelocity} units/day, stock will zero out in ${daysRemaining} days.`;

      stockoutRisks.push({
        productId: p.id,
        sku: p.sku,
        name: p.name,
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
  const orgName = org?.name ?? "Adaeze Wholesale Operations";

  const debtDrafts: DebtReminderDraft[] = topDebtors.map((debtor) => {
    const formatted = formatMoney(debtor.owesUsCents);
    return {
      customerId: debtor.customerId,
      customerName: debtor.name,
      phone: debtor.phone,
      owesCents: debtor.owesUsCents,
      tones: {
        respectful: `Good day ${debtor.name}, thank you for your ongoing partnership with ${orgName}. This is a courteous reminder that your account balance of ${formatted} is currently due. Kindly notify us once payment is scheduled so we can expedite your next warehouse reservations. Best regards!`,
        firm: `Hello ${debtor.name}, urgent notice from ${orgName} Finance: Your outstanding balance of ${formatted} is past due date. To ensure your pending stock holds and warehouse dispatch remain uninterrupted, kindly settle via your virtual account today. Thank you for your swift attention.`,
        pidgin: `Good morning ${debtor.name}! How market today? Quick reminder say your balance of ${formatted} with ${orgName} don mature for settlement o. Abeg make you run the transfer make we clear am so boys fit pack your next batch quick quick. God bless your hustle!`,
      },
    };
  });

  // Critical Alerts Synthesis
  const criticalAlerts: OwnerAIBriefing["criticalAlerts"] = [];

  if (totalReceivablesCents > 0) {
    criticalAlerts.push({
      id: "alert-receivables",
      type: "DEBT",
      title: `${formatMoney(totalReceivablesCents)} Uncollected Customer Receivables`,
      detail: `${topDebtors.length} VIP wholesale accounts have mature pending balances.`,
      impact: "Affects cash flow for next factory supplier order.",
      actionLabel: "Review & Send WhatsApp Reminders",
      actionHref: "/reports",
      severity: totalReceivablesCents > 1_000_000 ? "HIGH" : "MEDIUM",
    });
  }

  if (stockoutRisks.some((r) => r.urgency === "CRITICAL")) {
    const critCount = stockoutRisks.filter((r) => r.urgency === "CRITICAL").length;
    criticalAlerts.push({
      id: "alert-stockout",
      type: "STOCKOUT",
      title: `${critCount} High-Velocity SKUs in Imminent Stockout`,
      detail: `${stockoutRisks[0].name} (${stockoutRisks[0].sku}) has ${stockoutRisks[0].available} units left with active market demand.`,
      impact: "Risk of lost sales and customer redirection to competitors.",
      actionLabel: "Generate Supplier Reorder Sheet",
      actionHref: "/catalogue",
      severity: "HIGH",
    });
  }

  const pendingReturns = attentionResult.items.filter((i) => i.kind === "return");
  if (pendingReturns.length > 0) {
    criticalAlerts.push({
      id: "alert-returns",
      type: "REFUND",
      title: `${pendingReturns.length} Pending Return / Refund Request(s)`,
      detail: "Customer returns require Owner authorization before warehouse restocking.",
      impact: "Delays customer store credit or bank settlement.",
      actionLabel: "Review Return Slips",
      actionHref: "/operations",
      severity: "MEDIUM",
    });
  }

  // Summary generation
  const debtorHighlight =
    topDebtors.length > 0
      ? `You have ${formatMoney(totalReceivablesCents)} across ${topDebtors.length} debtor accounts.`
      : "All client balances are up to date.";

  const stockHighlight =
    stockoutRisks.length > 0
      ? `${stockoutRisks.length} product(s) require inventory replenishment.`
      : "Warehouse inventory levels are healthy across all SKUs.";

  const executiveHeadline =
    todayCashCents > 0
      ? `${formatMoney(todayCashCents)} Collected Today · ${recentChatsCount} Active Inbound Chats`
      : `${recentChatsCount} Active WhatsApp Inquiries · ${topDebtors.length} Receivables Requiring Action`;

  const summaryParagraph = `In the past 24 hours, your wholesale operations logged ${recentChatsCount} inbound customer WhatsApp chats and collected ${formatMoney(todayCashCents)} (bringing your 7-day verified cash to ${formatMoney(weekCashCents)}). ${debtorHighlight} On the warehouse floor, ${stockHighlight}`;

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
