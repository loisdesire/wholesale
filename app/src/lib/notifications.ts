import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { userScopedDb, type DbClient } from "@/lib/db";
import { isEmailConfigured, sendEmail } from "@/lib/email";

/**
 * In-app notices. Creation is idempotent per (user, dedupeKey): an event that fires
 * twice, or a retried job, asks for the same notice again and gets no duplicate.
 *
 * Email is a second, best-effort channel layered on top (see `src/lib/email.ts`) —
 * sent only when every targeted recipient's row was genuinely new this call. A
 * retry (all duplicates) sends no email, by the same dedupe the in-app row already
 * uses; a partial overlap (some recipients already notified, e.g. a late-added
 * owner) is treated the same as a retry rather than guessed at, so this channel
 * never risks a second email for someone who already got one. Nothing here blocks
 * or fails the primary in-app notification: a down or unconfigured email provider
 * never undoes the notify() call or throws past it.
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
  if (created.count === userIds.length) {
    await emailRecipients(userIds, params.title, params.body, params.href);
  }
  return created.count;
}

/** Best-effort email fan-out; User is identity data, read via the root client like everywhere else. */
async function emailRecipients(userIds: string[], title: string, body: string | undefined, href: string | undefined) {
  if (!isEmailConfigured()) return;
  const recipients = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { email: true } });
  const link = href && process.env.APP_URL ? `${process.env.APP_URL}${href}` : null;
  const text = [body, link].filter(Boolean).join("\n\n");
  await Promise.all(
    recipients.map((r) =>
      sendEmail(r.email, title, text).catch((err) => {
        // Best-effort: the in-app notification already exists and is the source of
        // truth. Log and move on — never let a down/misconfigured email provider
        // fail the business action that triggered this notification.
        console.error(`email notification failed for ${r.email}:`, err instanceof Error ? err.message : err);
      })
    )
  );
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
