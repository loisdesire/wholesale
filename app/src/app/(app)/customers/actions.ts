"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  CustomerError,
  DuplicateCustomerError,
  addCustomerAddress,
  createCustomer,
  removeCustomerAddress,
  removeCustomerPrice,
  setCustomerPrice,
  setDefaultAddress,
  updateCustomer,
} from "@/lib/customers";

export type FormState = { error: string | null; existingId?: string; saved?: boolean };

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");
  return session;
}

function friendly(err: unknown): string {
  if (err instanceof CustomerError) return err.message;
  throw err;
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

export async function createCustomerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  let customerId: string;
  try {
    const customer = await createCustomer({
      organizationId: session.user.organizationId,
      phone: text(formData, "phone"),
      name: text(formData, "name"),
      email: text(formData, "email"),
      notes: text(formData, "notes"),
      actorId: session.user.id,
    });
    customerId = customer.id;
  } catch (err) {
    if (err instanceof DuplicateCustomerError) {
      return { error: err.message, existingId: err.existingId };
    }
    return { error: friendly(err) };
  }
  revalidatePath("/customers");
  redirect(`/customers/${customerId}`);
}

export async function updateCustomerAction(customerId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  try {
    await updateCustomer({
      organizationId: session.user.organizationId,
      customerId,
      actorId: session.user.id,
      name: text(formData, "name"),
      email: text(formData, "email"),
      notes: text(formData, "notes"),
    });
  } catch (err) {
    return { error: friendly(err) };
  }
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  return { error: null, saved: true };
}

export async function addAddressAction(customerId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  try {
    await addCustomerAddress({
      organizationId: session.user.organizationId,
      customerId,
      actorId: session.user.id,
      label: text(formData, "label"),
      text: text(formData, "text"),
    });
  } catch (err) {
    return { error: friendly(err) };
  }
  revalidatePath(`/customers/${customerId}`);
  return { error: null };
}

export async function setDefaultAddressAction(customerId: string, addressId: string): Promise<void> {
  const session = await requireSession();
  try {
    await setDefaultAddress({ organizationId: session.user.organizationId, customerId, addressId, actorId: session.user.id });
  } catch (err) {
    friendly(err);
  }
  revalidatePath(`/customers/${customerId}`);
}

export async function removeAddressAction(customerId: string, addressId: string): Promise<void> {
  const session = await requireSession();
  try {
    await removeCustomerAddress({ organizationId: session.user.organizationId, customerId, addressId, actorId: session.user.id });
  } catch (err) {
    friendly(err);
  }
  revalidatePath(`/customers/${customerId}`);
}

const priceSchema = z.object({
  productId: z.string().min(1, "Choose a product."),
  priceNaira: z.coerce.number().positive("The agreed price must be greater than zero."),
});

export async function setPriceAction(customerId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireSession();
  const parsed = priceSchema.safeParse({ productId: formData.get("productId"), priceNaira: formData.get("priceNaira") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid price." };
  try {
    await setCustomerPrice({
      organizationId: session.user.organizationId,
      customerId,
      productId: parsed.data.productId,
      priceCents: Math.round(parsed.data.priceNaira * 100),
      actorId: session.user.id,
      actorRole: session.user.role,
    });
  } catch (err) {
    return { error: friendly(err) };
  }
  revalidatePath(`/customers/${customerId}`);
  return { error: null };
}

export async function removePriceAction(customerId: string, productId: string): Promise<void> {
  const session = await requireSession();
  try {
    await removeCustomerPrice({
      organizationId: session.user.organizationId,
      customerId,
      productId,
      actorId: session.user.id,
      actorRole: session.user.role,
    });
  } catch (err) {
    friendly(err);
  }
  revalidatePath(`/customers/${customerId}`);
}
