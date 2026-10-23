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
  updateOrderItemQuantity,
  updateOrderDetails,
  shipOrderItems,
  closeOrderShort,
  amendConfirmedOrder,
  OrderStateError,
} from "@/lib/orders";
import { InsufficientStockError } from "@/lib/stock";
import { CustomerError, DuplicateCustomerError, createCustomer } from "@/lib/customers";
import { ReturnPermissionError } from "@/lib/returns";

export type FormState = { error: string | null };

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");
  return session;
}

function friendlyError(err: unknown): string {
  if (
    err instanceof InsufficientStockError ||
    err instanceof OrderStateError ||
    err instanceof ReturnPermissionError ||
    err instanceof CustomerError
  ) {
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
  deliveryAddress: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
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
    deliveryAddress: formData.get("deliveryAddress") || undefined,
    notes: formData.get("notes") || undefined,
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
    try {
      const customer = await createCustomer({
        organizationId: session.user.organizationId,
        phone: data.customerPhone,
        name: data.customerName,
        actorId: session.user.id,
      });
      customerId = customer.id;
    } catch (err) {
      if (err instanceof DuplicateCustomerError) {
        return { error: `${err.message} Choose them from the customer list instead of creating a duplicate.` };
      }
      return { error: friendlyError(err) };
    }
  }

  let orderId: string;
  try {
    const order = await createDraftOrder({
      organizationId: session.user.organizationId,
      customerId,
      conversationId: data.conversationId,
      createdById: session.user.id,
      items: data.items,
      deliveryAddress: data.deliveryAddress,
      notes: data.notes,
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

export async function confirmOrderAction(
  orderId: string,
  allowDuplicate: boolean,
  _prevState: FormState
): Promise<FormState> {
  void _prevState; // required by useActionState's signature
  const session = await requireSession();
  try {
    await confirmOrder({
      organizationId: session.user.organizationId,
      orderId,
      actorId: session.user.id,
      allowDuplicate,
    });
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

export async function cancelOrderAction(orderId: string, _prevState: FormState): Promise<FormState> {
  void _prevState; // required by useActionState's signature
  const session = await requireSession();
  try {
    await cancelOrder({
      organizationId: session.user.organizationId,
      orderId,
      actorId: session.user.id,
      actorRole: session.user.role,
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/catalogue");
  revalidatePath("/");
  return { error: null };
}

export async function updateItemQuantityAction(
  orderId: string,
  orderItemId: string,
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await requireSession();
  try {
    await updateOrderItemQuantity({
      organizationId: session.user.organizationId,
      orderId,
      orderItemId,
      quantity: Number(formData.get("quantity")),
      actorId: session.user.id,
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  return { error: null };
}

export async function updateOrderDetailsAction(
  orderId: string,
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await requireSession();
  try {
    await updateOrderDetails({
      organizationId: session.user.organizationId,
      orderId,
      actorId: session.user.id,
      notes: String(formData.get("notes") ?? ""),
      deliveryAddress: String(formData.get("deliveryAddress") ?? ""),
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/orders/${orderId}`);
  return { error: null };
}

/** Inputs are named qty_<orderItemId>; blank or 0 means "not in this shipment". */
export async function shipItemsAction(orderId: string, _prevState: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const items: { orderItemId: string; quantity: number }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("qty_") || !value || Number(value) === 0) continue;
    items.push({ orderItemId: key.slice(4), quantity: Number(value) });
  }
  try {
    await shipOrderItems({
      organizationId: session.user.organizationId,
      orderId,
      actorId: session.user.id,
      items,
      carrier: String(formData.get("carrier") ?? ""),
      trackingReference: String(formData.get("trackingReference") ?? ""),
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/catalogue");
  revalidatePath("/");
  return { error: null };
}

export async function closeShortAction(orderId: string, _prevState: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  try {
    await closeOrderShort({
      organizationId: session.user.organizationId,
      orderId,
      actorId: session.user.id,
      actorRole: session.user.role,
      reason: String(formData.get("reason") ?? ""),
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/catalogue");
  revalidatePath("/customers");
  revalidatePath("/");
  return { error: null };
}

/** Inputs: qty_<orderItemId> (0 removes the line), addProductId + addQuantity, reason. */
export async function amendOrderAction(orderId: string, _prevState: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const changes: { orderItemId: string; quantity: number }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("qty_") || value === "") continue;
    changes.push({ orderItemId: key.slice(4), quantity: Number(value) });
  }
  const addProductId = String(formData.get("addProductId") ?? "");
  const addQuantity = Number(formData.get("addQuantity") ?? 0);
  try {
    await amendConfirmedOrder({
      organizationId: session.user.organizationId,
      orderId,
      actorId: session.user.id,
      reason: String(formData.get("reason") ?? ""),
      amendment: {
        changes,
        additions: addProductId && addQuantity > 0 ? [{ productId: addProductId, quantity: addQuantity }] : [],
      },
    });
  } catch (err) {
    return { error: friendlyError(err) };
  }
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/catalogue");
  revalidatePath("/");
  return { error: null };
}
