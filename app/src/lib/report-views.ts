import { tenantDb } from "@/lib/db";

export class ReportViewError extends Error {}

const MAX_NAME_LENGTH = 60;

export type ReportViewSummary = {
  id: string;
  name: string;
  fromDate: Date;
  toDate: Date;
  createdAt: Date;
  createdByName: string | null;
};

/** Every saved view for the organization, newest first — shared across the whole team. */
export async function listReportViews(organizationId: string): Promise<ReportViewSummary[]> {
  const rows = await tenantDb(organizationId).reportView.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    fromDate: r.fromDate,
    toDate: r.toDate,
    createdAt: r.createdAt,
    createdByName: r.createdBy?.name ?? null,
  }));
}

/**
 * Saves the current date range under a name so the team can come back to it later —
 * any staff member can save one, this is a shared convenience list, not a permission.
 */
export async function saveReportView(params: {
  organizationId: string;
  createdById: string;
  name: string;
  from: Date;
  to: Date;
}): Promise<void> {
  const name = params.name.trim();
  if (!name) throw new ReportViewError("Give this view a name.");
  if (name.length > MAX_NAME_LENGTH) {
    throw new ReportViewError(`Keep the name under ${MAX_NAME_LENGTH} characters.`);
  }
  if (params.from > params.to) {
    throw new ReportViewError("The start date must be on or before the end date.");
  }

  await tenantDb(params.organizationId).reportView.create({
    data: {
      organizationId: params.organizationId,
      createdById: params.createdById,
      name,
      fromDate: params.from,
      toDate: params.to,
    },
  });
}

/** Removes a saved view. Any staff member can remove one — same "shared list" reasoning as saving. */
export async function deleteReportView(params: { organizationId: string; id: string }): Promise<void> {
  const db = tenantDb(params.organizationId);
  const existing = await db.reportView.findFirst({ where: { id: params.id, organizationId: params.organizationId } });
  if (!existing) throw new ReportViewError("That view no longer exists.");
  await db.reportView.delete({ where: { id: params.id } });
}
