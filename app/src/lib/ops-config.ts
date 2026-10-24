/**
 * How long work may wait before it counts as an exception. One place, in hours, so
 * the control room, the dashboard and the metrics all agree on what "overdue" means.
 * (Per-organization overrides are a later step; today these apply to everyone.)
 */
export const HOUR_MS = 60 * 60 * 1000;

export const SLA = {
  /** A customer message nobody has answered. */
  conversationWaitingWarnHours: 2,
  conversationWaitingCriticalHours: 24,
  /** A draft nobody confirmed. */
  draftStaleWarnHours: 24,
  /** Confirmed but not yet paid. */
  paymentOverdueWarnHours: 48,
  paymentOverdueCriticalHours: 24 * 7,
  /** Paid but not (fully) shipped. */
  shipOverdueWarnHours: 48,
  shipOverdueCriticalHours: 24 * 5,
  /** A part-shipped order with nothing new shipped for this long. */
  partialStaleWarnHours: 24 * 5,
  /** A return request waiting for the owner. */
  returnDecisionWarnHours: 24,
  returnDecisionCriticalHours: 24 * 3,
  /** An approved return whose goods haven't been booked in. */
  returnReceiveWarnHours: 24 * 7,
  /** An approved refund not yet paid out. */
  refundPayWarnHours: 72,
  refundPayCriticalHours: 24 * 10,
} as const;

export type Severity = "critical" | "warning" | "info";

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
