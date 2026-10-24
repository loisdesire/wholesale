import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { transaction, type DbClient } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { lockRow } from "@/lib/locks";
import { notify } from "@/lib/notifications";

export class AssignmentError extends Error {}

export type AssignableKind = "order" | "return" | "conversation";
type Actor = { id: string; role: UserRole };

/** Also the Postgres table name each kind lives in — `lockRow` takes the same strings. */
const ENTITY = { order: "Order", return: "OrderReturn", conversation: "Conversation" } as const;
const NOUN = { order: "order", return: "return", conversation: "conversation" } as const;

type Loaded = {
  assignedToId: string | null;
  assignedToName: string | null;
  /** null when the work is open and can be assigned; otherwise why it can't. */
  closedReason: string | null;
  label: string;
  href: string;
  entityId: string;
};

async function load(tx: DbClient, organizationId: string, kind: AssignableKind, id: string): Promise<Loaded> {
  const assignedToSelect = { select: { name: true } } as const;
  if (kind === "order") {
    const o = await tx.order.findFirst({ where: { id, organizationId }, include: { assignedTo: assignedToSelect } });
    if (!o) throw new AssignmentError("Order not found.");
    const closed = o.status === "FULFILLED" || o.status === "CANCELLED";
    return {
      assignedToId: o.assignedToId,
      assignedToName: o.assignedTo?.name ?? null,
      closedReason: closed ? `This order is already ${o.status === "FULFILLED" ? "fulfilled" : "cancelled"}.` : null,
      label: o.reference,
      href: `/orders/${o.id}`,
      entityId: o.id,
    };
  }
  if (kind === "return") {
    const r = await tx.orderReturn.findFirst({ where: { id, organizationId }, include: { assignedTo: assignedToSelect } });
    if (!r) throw new AssignmentError("Return not found.");
    const open = r.status === "REQUESTED" || r.status === "APPROVED" || r.refundStatus === "PENDING";
    return {
      assignedToId: r.assignedToId,
      assignedToName: r.assignedTo?.name ?? null,
      closedReason: open ? null : "This return is already finished.",
      label: r.reference,
      href: `/orders/${r.orderId}`,
      entityId: r.id,
    };
  }
  const c = await tx.conversation.findFirst({
    where: { id, organizationId },
    include: { customer: true, assignedTo: assignedToSelect },
  });
  if (!c) throw new AssignmentError("Conversation not found.");
  return {
    assignedToId: c.assignedToId,
    assignedToName: c.assignedTo?.name ?? null,
    closedReason: c.status === "RESOLVED" ? "This conversation is already resolved." : null,
    label: `the conversation with ${c.customer.name ?? c.customer.phone}`,
    href: `/inbox/${c.id}`,
    entityId: c.id,
  };
}

/** Why `actor` may not make this assignment, or null if they may. */
function permissionProblem(actor: Actor, currentAssigneeId: string | null, newAssigneeId: string | null) {
  if (actor.role === UserRole.OWNER) return null;
  // Staff may only move work between "unassigned" and "assigned to themselves" —
  // never touch an assignment that currently belongs to somebody else, and never
  // hand their own work to somebody else (that's an owner's call either way).
  if (currentAssigneeId !== null && currentAssigneeId !== actor.id) {
    return "Only an owner can take this off the person it's assigned to.";
  }
  if (newAssigneeId !== null && newAssigneeId !== actor.id) {
    return "Only an owner can assign this to someone else.";
  }
  return null;
}

async function assertMember(organizationId: string, userId: string) {
  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    include: { user: true },
  });
  if (!membership) throw new AssignmentError("That person isn't a member of this organization.");
  return membership.user;
}

/**
 * Assigns (or, with null, unassigns) one order, return or conversation. Owners may
 * assign anyone; staff may take work for themselves or put back work that is theirs.
 * Closed work can't be assigned. No-ops (same assignee) change and notify nothing.
 */
export async function assignWork(params: {
  organizationId: string;
  kind: AssignableKind;
  id: string;
  assigneeId: string | null;
  actor: Actor;
  /** Set by bulk operations so the audit trail shows how it happened. */
  bulk?: boolean;
  /** Checks permissions and the resulting outcome without writing anything. */
  dryRun?: boolean;
}) {
  const assignee = params.assigneeId ? await assertMember(params.organizationId, params.assigneeId) : null;

  return transaction(params.organizationId, async (tx) => {
    // A dry run only reads — no write follows, so there's nothing to serialize against.
    if (!params.dryRun) await lockRow(tx, ENTITY[params.kind], params.id);
    const current = await load(tx, params.organizationId, params.kind, params.id);

    const problem = permissionProblem(params.actor, current.assignedToId, params.assigneeId);
    if (problem) throw new AssignmentError(problem);
    if (current.assignedToId === params.assigneeId) return { changed: false as const, label: current.label, href: current.href };
    if (current.closedReason && params.assigneeId) throw new AssignmentError(current.closedReason);
    if (params.dryRun) return { changed: true as const, label: current.label, href: current.href };

    const data = { assignedToId: params.assigneeId };
    if (params.kind === "order") await tx.order.update({ where: { id: current.entityId }, data });
    else if (params.kind === "return") await tx.orderReturn.update({ where: { id: current.entityId }, data });
    else await tx.conversation.update({ where: { id: current.entityId }, data });

    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: ENTITY[params.kind],
        entityId: current.entityId,
        action: params.assigneeId ? `${ENTITY[params.kind].toUpperCase()}_ASSIGNED` : `${ENTITY[params.kind].toUpperCase()}_UNASSIGNED`,
        actorId: params.actor.id,
        before: { assignedTo: current.assignedToName },
        after: { assignedTo: assignee?.name ?? null, ...(params.bulk ? { bulk: true } : {}) },
      },
      tx
    );

    if (assignee && assignee.id !== params.actor.id) {
      await notify(tx, {
        organizationId: params.organizationId,
        userIds: [assignee.id],
        kind: "ASSIGNED",
        title: `You were assigned ${NOUN[params.kind] === "conversation" ? current.label : `${NOUN[params.kind]} ${current.label}`}`,
        href: current.href,
        dedupeKey: `assigned:${params.kind}:${current.entityId}:${assignee.id}:${Date.now()}`,
      });
    }
    return { changed: true as const, label: current.label, href: current.href };
  });
}

export type BulkAssignResult = {
  orderId: string;
  reference: string | null;
  ok: boolean;
  /** For a preview: what would happen. For an applied run: what did happen. */
  outcome: "assigned" | "unassigned" | "unchanged" | "refused";
  reason?: string;
};

const MAX_BULK = 100;
/** How many orders' transactions run at once — bounded so a 100-order bulk action
 * doesn't open 100 simultaneous connections, but not so serial it's 100 round-trips. */
const BULK_CONCURRENCY = 10;

/**
 * Assigns many orders at once. `dryRun` previews the effect without changing
 * anything — same permission/closed checks as applying, just stopped before the
 * write. Every order is handled on its own, so one that can't be assigned
 * (finished, unknown, not permitted) is reported and the rest still go through —
 * a bulk action never fails silently or half-applies without saying which half.
 */
export async function bulkAssignOrders(params: {
  organizationId: string;
  orderIds: string[];
  assigneeId: string | null;
  actor: Actor;
  dryRun?: boolean;
}): Promise<BulkAssignResult[]> {
  const ids = [...new Set(params.orderIds)];
  if (ids.length === 0) throw new AssignmentError("Select at least one order.");
  if (ids.length > MAX_BULK) throw new AssignmentError(`Select at most ${MAX_BULK} orders at a time.`);
  if (params.assigneeId) await assertMember(params.organizationId, params.assigneeId);

  const oneOrder = async (orderId: string): Promise<BulkAssignResult> => {
    try {
      const done = await assignWork({
        organizationId: params.organizationId,
        kind: "order",
        id: orderId,
        assigneeId: params.assigneeId,
        actor: params.actor,
        bulk: true,
        dryRun: params.dryRun,
      });
      return {
        orderId,
        reference: done.label,
        ok: true,
        outcome: !done.changed ? "unchanged" : params.assigneeId ? "assigned" : "unassigned",
      };
    } catch (err) {
      if (!(err instanceof AssignmentError)) throw err;
      return { orderId, reference: null, ok: false, outcome: "refused", reason: err.message };
    }
  };

  const results: BulkAssignResult[] = [];
  for (let i = 0; i < ids.length; i += BULK_CONCURRENCY) {
    results.push(...(await Promise.all(ids.slice(i, i + BULK_CONCURRENCY).map(oneOrder))));
  }
  return results;
}
