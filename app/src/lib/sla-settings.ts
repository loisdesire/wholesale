import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_SLA, resolveSla, type SlaKey, type SlaOverrides, type SlaThresholds } from "@/lib/ops-config";

export class SlaSettingsError extends Error {}

/** Warning/critical pairs that must stay ordered — a "critical" tier sooner than its own warning tier makes no sense. */
const PAIRS: [SlaKey, SlaKey][] = [
  ["conversationWaitingWarnHours", "conversationWaitingCriticalHours"],
  ["paymentOverdueWarnHours", "paymentOverdueCriticalHours"],
  ["shipOverdueWarnHours", "shipOverdueCriticalHours"],
  ["returnDecisionWarnHours", "returnDecisionCriticalHours"],
  ["refundPayWarnHours", "refundPayCriticalHours"],
];

const MAX_HOURS = 24 * 365; // a year — generous, but not "never" (an unbounded value defeats the point of an SLA)

/**
 * The organization's current SLA configuration: its raw overrides (for the form,
 * blank where nothing is overridden), the hard defaults (for placeholders), and the
 * effective thresholds the attention queue and metrics actually use.
 */
export async function getSlaSettings(organizationId: string): Promise<{
  overrides: SlaOverrides;
  defaults: SlaThresholds;
  effective: SlaThresholds;
}> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { slaOverrides: true } });
  const overrides = (org.slaOverrides as SlaOverrides | null) ?? {};
  return { overrides, defaults: DEFAULT_SLA, effective: resolveSla(overrides) };
}

/**
 * Replaces the organization's SLA overrides wholesale (not a merge) — the form always
 * submits every field, blank meaning "use the default", so this mirrors exactly what
 * the owner saw and chose. Owner-only; validates each present value is a positive,
 * bounded integer and that every warning/critical pair stays ordered.
 */
export async function updateSlaOverrides(params: {
  organizationId: string;
  actor: { role: UserRole };
  overrides: Partial<Record<SlaKey, number | null>>;
}): Promise<void> {
  if (params.actor.role !== UserRole.OWNER) {
    throw new SlaSettingsError("Only an owner can change these thresholds.");
  }

  const cleaned: SlaOverrides = {};
  for (const [key, value] of Object.entries(params.overrides) as [SlaKey, number | null][]) {
    if (value === null || value === undefined) continue; // blank → use the default
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0 || value > MAX_HOURS) {
      throw new SlaSettingsError(`"${key}" must be a whole number of hours between 1 and ${MAX_HOURS}.`);
    }
    cleaned[key] = value;
  }

  const effective = resolveSla(cleaned);
  for (const [warnKey, criticalKey] of PAIRS) {
    if (effective[warnKey] >= effective[criticalKey]) {
      throw new SlaSettingsError(`The warning threshold must be sooner than the critical one for "${warnKey}".`);
    }
  }

  await prisma.organization.update({ where: { id: params.organizationId }, data: { slaOverrides: cleaned } });
}
