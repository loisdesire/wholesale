import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { transaction, type DbClient } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { lockRow } from "@/lib/locks";
import { notify } from "@/lib/notifications";

export class AssignmentError extends Error {}

export type AssignableKind = "order" | "return" | "conversation";
type Actor = { id: string; role: UserRole };

const TABLE = { order: "Order", return: "OrderReturn", conversation: "Conversation" } as const;
const ENTITY = { order: "Order", return: "OrderReturn", conversation: "Conversation" } as const;
const NOUN = { order: "order", return: "return", conversation: "conversation" } as const;

type Loaded = {
  assignedToId: string | null;
  /** null when the work is open and can be assigned; otherwise why it can't. */
  closedReason: string | null;
  label: string;
  href: string;
  entityId: string;
};

async function load(tx: DbClient, organizationId: string, kind: AssignableKind, id: string): Promise<Loaded> {
  if (kind === "order") {
    const o = await tx.order.findFirst({ where: { id, organizationId } });
    if (!o) throw new AssignmentError("Order not found.");
    const closed = o.status === "FULFILLED" || o.status === "CANCELLED";
    return {
      assignedToId: o.assignedToId,
      closedReason: closed ? `This order is already ${o.status === "FULFILLED" ? "fulfilled" : "cancelled"}.` : null,
      label: o.reference,
      href: `/orders/${o.id}`,
      entityId: o.id,
    };
  }
  if (kind === "return") {
    const r = await tx.orderReturn.findFirst({ where: { id, organizationId } });
    if (!r) throw new AssignmentError("Return not found.");
    const open = r.status === "REQUESTED" || r.status === "APPROVED" || r.refundStatus === "PENDING";
    return {
      assignedToId: r.assignedToId,
      closedReason: open ? null : "This return is already finished.",
      label: r.reference,
      href: `/orders/${r.orderId}`,
      entityId: r.id,
    };
  }
  const c = await tx.conversation.findFirst({ where: { id, organizationId }, include: { customer: true } });
  if (!c) throw new AssignmentError("Conversation not found.");
  return {
    assignedToId: c.assignedToId,
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
}) {
  const assignee = params.assigneeId ? await assertMember(params.organizationId, params.assigneeId) : null;

  return transaction(params.organizationId, async (tx) => {
    await lockRow(tx, TABLE[params.kind], params.id);
    const current = await load(tx, params.organizationId, params.kind, params.id);

    const problem = permissionProblem(params.actor, current.assignedToId, params.assigneeId);
    if (problem) throw new AssignmentError(problem);
    if (current.assignedToId === params.assigneeId) return { changed: false as const, label: current.label };
    if (current.closedReason && params.assigneeId) throw new AssignmentError(current.closedReason);

    const data = { assignedToId: params.assigneeId };
    if (params.kind === "order") await tx.order.update({ where: { id: current.entityId }, data });
    else if (params.kind === "return") await tx.orderReturn.update({ where: { id: current.entityId }, data });
    else await tx.conversation.update({ where: { id: current.entityId }, data });

    const before = current.assignedToId
      ? (await prisma.user.findUnique({ where: { id: current.assignedToId } }))?.name ?? null
      : null;
    await recordAudit(
      {
        organizationId: params.organizationId,
        entity: ENTITY[params.kind],
        entityId: current.entityId,
        action: params.assigneeId ? `${ENTITY[params.kind].toUpperCase()}_ASSIGNED` : `${ENTITY[params.kind].toUpperCase()}_UNASSIGNED`,
        actorId: params.actor.id,
        before: { assignedTo: before },
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
    return { changed: true as const, label: current.label };
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

/**
 * Assigns many orders at once. `dryRun` previews the effect without changing
 * anything. Every order is handled on its own, so one that can't be assigned
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

  const results: BulkAssignResult[] = [];
  for (const orderId of ids) {
    try {
      if (params.dryRun) {
        results.push(await previewOne(params, orderId));
      } else {
        const done = await assignWork({
          organizationId: params.organizationId,
          kind: "order",
          id: orderId,
          assigneeId: params.assigneeId,
          actor: params.actor,
          bulk: true,
        });
        results.push({
          orderId,
          reference: done.label,
          ok: true,
          outcome: !done.changed ? "unchanged" : params.assigneeId ? "assigned" : "unassigned",
        });
      }
    } catch (err) {
      if (!(err instanceof AssignmentError)) throw err;
      results.push({ orderId, reference: null, ok: false, outcome: "refused", reason: err.message });
    }
  }
  return results;
}

async function previewOne(
  params: { organizationId: string; assigneeId: string | null; actor: Actor },
  orderId: string
): Promise<BulkAssignResult> {
  return transaction(params.organizationId, async (tx) => {
    const current = await load(tx, params.organizationId, "order", orderId);
    const problem = permissionProblem(params.actor, current.assignedToId, params.assigneeId);
    if (problem) return { orderId, reference: current.label, ok: false, outcome: "refused" as const, reason: problem };
    if (current.assignedToId === params.assigneeId) return { orderId, reference: current.label, ok: true, outcome: "unchanged" as const };
    if (current.closedReason && params.assigneeId) {
      return { orderId, reference: current.label, ok: false, outcome: "refused" as const, reason: current.closedReason };
    }
    return { orderId, reference: current.label, ok: true, outcome: params.assigneeId ? ("assigned" as const) : ("unassigned" as const) };
  });
}
