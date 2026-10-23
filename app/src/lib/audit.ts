import type { Prisma } from "@prisma/client";
import type { DbClient } from "@/lib/db";

type AuditParams = {
  organizationId: string;
  entity: string;
  entityId: string;
  action: string;
  actorId?: string;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
};

export async function recordAudit(params: AuditParams, client: DbClient) {
  return client.auditLog.create({
    data: {
      organizationId: params.organizationId,
      entity: params.entity,
      entityId: params.entityId,
      action: params.action,
      actorId: params.actorId,
      before: params.before ?? undefined,
      after: params.after ?? undefined,
    },
  });
}
