import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { userScopedDb, type DbClient } from "@/lib/db";

/**
 * In-app notices. Creation is idempotent per (user, dedupeKey): an event that fires
 * twice, or a retried job, asks for the same notice again and gets no duplicate.
 */
export async function notify(
  tx: DbClient,
  params: {
    organizationId: string;
    userIds: string[];
    kind: string;
    title: string;
    body?: string;
    href?: string;
    /** Same key for the same underlying event, e.g. "return-requested:<returnId>". */
    dedupeKey: string;
  }
) {
  const userIds = [...new Set(params.userIds)];
  if (userIds.length === 0) return 0;
  const created = await tx.notification.createMany({
    data: userIds.map((userId) => ({
      organizationId: params.organizationId,
      userId,
      kind: params.kind,
      title: params.title,
      body: params.body,
      href: params.href,
      dedupeKey: params.dedupeKey,
    })),
    skipDuplicates: true,
  });
  return created.count;
}

/** The people who must be told about owner-level events (membership is identity data, not tenant data). */
export async function ownerUserIds(organizationId: string): Promise<string[]> {
  const owners = await prisma.membership.findMany({
    where: { organizationId, role: UserRole.OWNER },
    select: { userId: true },
  });
  return owners.map((o) => o.userId);
}

export async function unreadCount(organizationId: string, userId: string) {
  return userScopedDb(organizationId, userId).notification.count({ where: { organizationId, userId, readAt: null } });
}

export async function listNotifications(organizationId: string, userId: string, take = 50) {
  return userScopedDb(organizationId, userId).notification.findMany({
    where: { organizationId, userId },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/** Marks the given notices read — only ever the caller's own (the database enforces it, not just this `where`). */
export async function markRead(organizationId: string, userId: string, ids: string[]) {
  const result = await userScopedDb(organizationId, userId).notification.updateMany({
    where: { organizationId, userId, id: { in: ids }, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function markAllRead(organizationId: string, userId: string) {
  const result = await userScopedDb(organizationId, userId).notification.updateMany({
    where: { organizationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}
