"use server";

import { revalidatePath } from "next/cache";
import { ReturnItemCondition } from "@prisma/client";
import { auth } from "@/lib/auth";
import {
  ReturnPermissionError,
  ReturnStateError,
  decideReturn,
  markRefunded,
  receiveReturn,
  requestReturn,
} from "@/lib/returns";
import { InsufficientStockError, StockInvariantError } from "@/lib/stock";

export type FormState = { error: string | null };

async function requireActor() {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");
  return {
    organizationId: session.user.organizationId,
    actor: { id: session.user.id, role: session.user.role },
  };
}

function friendlyError(err: unknown): string {
  if (
    err instanceof ReturnStateError ||
    err instanceof ReturnPermissionError ||
    err instanceof InsufficientStockError ||
    err instanceof StockInvariantError
  ) {
    return err.message;
  }
  throw err;
}

function refresh(orderId: string) {
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/customers");
  revalidatePath("/catalogue");
  revalidatePath("/");
}

export async function requestReturnAction(
  orderId: string,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const { organizationId, actor } = await requireActor();

  // Inputs are named qty_<orderItemId> / condition_<orderItemId>; blank or 0 means "not returning this line".
  const items: { orderItemId: string; quantity: number; condition: ReturnItemCondition }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("qty_")) continue;
    const quantity = Number(value);
    if (!value || quantity === 0) continue;
    const orderItemId = key.slice(4);
    const condition =
      formData.get(`condition_${orderItemId}`) === ReturnItemCondition.DAMAGED
        ? ReturnItemCondition.DAMAGED
        : ReturnItemCondition.RESELLABLE;
    items.push({ orderItemId, quantity, condition });
  }

  try {
    await requestReturn({
      organizationId,
      orderId,
      actor,
      reason: String(formData.get("reason") ?? ""),
      items,
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  refresh(orderId);
  return { error: null };
}

export async function decideReturnAction(
  returnId: string,
  approve: boolean,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const { organizationId, actor } = await requireActor();
  let orderId: string | undefined;
  try {
    // Optional "refund amount" (₦). Blank means the full value of the goods.
    const rawAmount = String(formData.get("refundNaira") ?? "").trim();
    const refundCents = approve && rawAmount !== "" ? Math.round(Number(rawAmount) * 100) : undefined;
    if (refundCents !== undefined && !Number.isFinite(refundCents)) return { error: "Enter the refund amount as a number." };
    const updated = await decideReturn({
      organizationId,
      returnId,
      actor,
      approve,
      note: String(formData.get("note") ?? ""),
      refundCents,
    });
    orderId = updated.orderId;
  } catch (err) {
    return { error: friendlyError(err) };
  }
  refresh(orderId);
  return { error: null };
}

export async function receiveReturnAction(returnId: string): Promise<FormState> {
  const { organizationId, actor } = await requireActor();
  let orderId: string | undefined;
  try {
    orderId = (await receiveReturn({ organizationId, returnId, actor })).orderId;
  } catch (err) {
    return { error: friendlyError(err) };
  }
  refresh(orderId);
  return { error: null };
}

export async function markRefundedAction(
  returnId: string,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const { organizationId, actor } = await requireActor();
  let orderId: string | undefined;
  try {
    orderId = (
      await markRefunded({ organizationId, returnId, actor, note: String(formData.get("note") ?? "") })
    ).orderId;
  } catch (err) {
    return { error: friendlyError(err) };
  }
  refresh(orderId);
  return { error: null };
}
