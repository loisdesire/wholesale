"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { AssignmentError, assignWork, bulkAssignOrders, type AssignableKind } from "@/lib/assignment";
import { markAllRead, markRead } from "@/lib/notifications";

export type FormState = { error: string | null; saved?: boolean };

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");
  return session;
}

function friendly(err: unknown): string {
  if (err instanceof AssignmentError) return err.message;
  throw err;
}

/** Inline assign/unassign control on an order, return or conversation. */
export async function assignAction(
  kind: AssignableKind,
  id: string,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await requireSession();
  const raw = String(formData.get("assigneeId") ?? "");
  let href: string;
  try {
    href = (
      await assignWork({
        organizationId: session.user.organizationId,
        kind,
        id,
        assigneeId: raw === "" ? null : raw,
        actor: { id: session.user.id, role: session.user.role },
      })
    ).href;
  } catch (err) {
    return { error: friendly(err) };
  }
  revalidatePath("/operations");
  revalidatePath("/orders");
  revalidatePath("/inbox");
  revalidatePath(href, "page");
  return { error: null, saved: true };
}

export type BulkAssignOutcome = Awaited<ReturnType<typeof bulkAssignOrders>>;

/** Previews a bulk assignment without applying it. */
export async function previewBulkAssignAction(orderIds: string[], assigneeId: string | null): Promise<BulkAssignOutcome> {
  const session = await requireSession();
  return bulkAssignOrders({
    organizationId: session.user.organizationId,
    orderIds,
    assigneeId,
    actor: { id: session.user.id, role: session.user.role },
    dryRun: true,
  });
}

/** Applies a previously previewed bulk assignment. */
export async function applyBulkAssignAction(orderIds: string[], assigneeId: string | null): Promise<BulkAssignOutcome> {
  const session = await requireSession();
  const result = await bulkAssignOrders({
    organizationId: session.user.organizationId,
    orderIds,
    assigneeId,
    actor: { id: session.user.id, role: session.user.role },
  });
  revalidatePath("/operations");
  revalidatePath("/orders");
  return result;
}

export async function markNotificationsReadAction(ids: string[]): Promise<void> {
  const session = await requireSession();
  await markRead(session.user.organizationId, session.user.id, ids);
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const session = await requireSession();
  await markAllRead(session.user.organizationId, session.user.id);
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}
