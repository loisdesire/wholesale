"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  createDraftOrder,
  addOrderItem,
  removeOrderItem,
  confirmOrder,
  markOrderPaid,
  markOrderFulfilled,
  cancelOrder,
  OrderStateError,
} from "@/lib/orders";
import { InsufficientStockError } from "@/lib/stock";

export type FormState = { error: string | null };

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");
  return session;
}

function friendlyError(err: unknown): string {
  if (err instanceof InsufficientStockError || err instanceof OrderStateError) {
    return err.message;
  }
  throw err;
}

const itemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int().positive(),
});

const newOrderSchema = z.object({
  customerMode: z.enum(["existing", "new"]),
  customerId: z.string().optional(),
  customerName: z.string().trim().max(200).optional(),
  customerPhone: z.string().trim().max(32).optional(),
  conversationId: z.string().optional(),
  items: z.array(itemSchema).min(1, "Add at least one item."),
});

export async function createOrderAction(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await requireSession();

  let items: unknown;
  try {
    items = JSON.parse(String(formData.get("itemsJson") ?? "[]"));
  } catch {
    return { error: "Could not read order items." };
  }

  const parsed = newOrderSchema.safeParse({
    customerMode: formData.get("customerMode"),
    customerId: formData.get("customerId") || undefined,
    customerName: formData.get("customerName") || undefined,
    customerPhone: formData.get("customerPhone") || undefined,
    conversationId: formData.get("conversationId") || undefined,
    items,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid order." };
  }
  const data = parsed.data;

  let customerId: string;
  if (data.customerMode === "existing") {
    if (!data.customerId) return { error: "Choose a customer." };
    const customer = await prisma.customer.findFirst({
      where: { id: data.customerId, organizationId: session.user.organizationId },
    });
    if (!customer) return { error: "Customer not found." };
    customerId = customer.id;
  } else {
    if (!data.customerPhone) return { error: "Phone number is required for a new customer." };
    const customer = await prisma.customer.create({
      data: {
        organizationId: session.user.organizationId,
        phone: data.customerPhone,
        name: data.customerName || null,
      },
    });
    customerId = customer.id;
  }

  let orderId: string;
  try {
    const order = await createDraftOrder({
      organizationId: session.user.organizationId,
      customerId,
      conversationId: data.conversationId,
      createdById: session.user.id,
      items: data.items,
    });
    orderId = order.id;
  } catch (err) {
    return { error: friendlyError(err) };
  }

  revalidatePath("/orders");
  redirect(`/orders/${orderId}`);
}

const addItemSchema = z.object({
  productId: z.string().min(1, "Choose a product."),
  quantity: z.coerce.number().int("Quantity must be a whole number").positive("Quantity must be greater than zero"),
});

export async function addOrderItemAction(
  orderId: string,
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await requireSession();

  const parsed = addItemSchema.safeParse({
    productId: formData.get("productId"),
    quantity: formData.get("quantity"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid item." };
  }

  try {
    await addOrderItem({
      organizationId: session.user.organizationId,
      orderId,
      productId: parsed.data.productId,
      quantity: parsed.data.quantity,
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }

  revalidatePath(`/orders/${orderId}`);
  return { error: null };
}

export async function removeOrderItemAction(orderId: string, orderItemId: string): Promise<void> {
  const session = await requireSession();
  try {
    await removeOrderItem({ organizationId: session.user.organizationId, orderId, orderItemId });
  } catch (err) {
    friendlyError(err);
  }
  revalidatePath(`/orders/${orderId}`);
}

export async function confirmOrderAction(orderId: string): Promise<FormState> {
  const session = await requireSession();
  try {
    await confirmOrder({ organizationId: session.user.organizationId, orderId, actorId: session.user.id });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/catalogue");
  revalidatePath("/");
  return { error: null };
}

export async function markPaidAction(orderId: string): Promise<FormState> {
  const session = await requireSession();
  try {
    await markOrderPaid({ organizationId: session.user.organizationId, orderId, actorId: session.user.id });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/");
  return { error: null };
}

export async function markFulfilledAction(orderId: string): Promise<FormState> {
  const session = await requireSession();
  try {
    await markOrderFulfilled({ organizationId: session.user.organizationId, orderId, actorId: session.user.id });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/");
  return { error: null };
}

export async function cancelOrderAction(orderId: string): Promise<FormState> {
  const session = await requireSession();
  try {
    await cancelOrder({ organizationId: session.user.organizationId, orderId, actorId: session.user.id });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/catalogue");
  revalidatePath("/");
  return { error: null };
}
