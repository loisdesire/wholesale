/**
 * How long work may wait before it counts as an exception. One place, in hours, so
 * the control room, the dashboard and the metrics all agree on what "overdue" means.
 * These are the defaults; an organization may override any of them (see
 * `resolveSla`) — the needs-attention queue and metrics always read the resolved
 * value, never this constant directly.
 */
export const HOUR_MS = 60 * 60 * 1000;

export const DEFAULT_SLA = {
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

/** Backward-compatible alias — prefer `resolveSla(org.slaOverrides)` in new code. */
export const SLA = DEFAULT_SLA;

export type SlaKey = keyof typeof DEFAULT_SLA;
export type SlaThresholds = Record<SlaKey, number>;
export type SlaOverrides = Partial<SlaThresholds>;

/** Merges an organization's overrides onto the defaults — an absent or invalid key keeps its default. */
export function resolveSla(overrides: unknown): SlaThresholds {
  const result: SlaThresholds = { ...DEFAULT_SLA };
  if (!overrides || typeof overrides !== "object") return result;
  for (const key of Object.keys(DEFAULT_SLA) as SlaKey[]) {
    const value = (overrides as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      result[key] = value;
    }
  }
  return result;
}

/** Metadata for rendering the per-organization SLA settings form, grouped and labelled. */
export const SLA_FIELDS: { key: SlaKey; label: string; group: string }[] = [
  { key: "conversationWaitingWarnHours", label: "Customer waiting for a reply (warning)", group: "Conversations" },
  { key: "conversationWaitingCriticalHours", label: "Customer waiting for a reply (critical)", group: "Conversations" },
  { key: "draftStaleWarnHours", label: "Draft order not confirmed", group: "Orders" },
  { key: "paymentOverdueWarnHours", label: "Confirmed, not yet paid (warning)", group: "Orders" },
  { key: "paymentOverdueCriticalHours", label: "Confirmed, not yet paid (critical)", group: "Orders" },
  { key: "shipOverdueWarnHours", label: "Paid, not yet shipped (warning)", group: "Orders" },
  { key: "shipOverdueCriticalHours", label: "Paid, not yet shipped (critical)", group: "Orders" },
  { key: "partialStaleWarnHours", label: "Part-shipped, nothing new shipped since", group: "Orders" },
  { key: "returnDecisionWarnHours", label: "Return awaiting the owner's decision (warning)", group: "Returns" },
  { key: "returnDecisionCriticalHours", label: "Return awaiting the owner's decision (critical)", group: "Returns" },
  { key: "returnReceiveWarnHours", label: "Approved return not yet booked in", group: "Returns" },
  { key: "refundPayWarnHours", label: "Refund approved, not yet paid out (warning)", group: "Returns" },
  { key: "refundPayCriticalHours", label: "Refund approved, not yet paid out (critical)", group: "Returns" },
];

export type Severity = "critical" | "warning" | "info";

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
