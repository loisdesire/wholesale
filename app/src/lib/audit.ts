import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type TxClient = Prisma.TransactionClient;

type AuditParams = {
  organizationId: string;
  entity: string;
  entityId: string;
  action: string;
  actorId?: string;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
};

export async function recordAudit(params: AuditParams, client: TxClient | typeof prisma = prisma) {
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
