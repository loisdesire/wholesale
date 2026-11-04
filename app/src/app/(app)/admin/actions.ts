"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { extendTrial, markSubscriptionActive, PlatformAdminError } from "@/lib/platform-admin";

export type FormState = { error: string | null; saved?: boolean };

async function requirePlatformAdmin() {
  const session = await auth();
  if (!session?.user.isPlatformAdmin) throw new Error("Platform admin only.");
  return session;
}

export async function extendTrialAction(organizationId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requirePlatformAdmin();
  const days = Number(formData.get("days"));

  try {
    await extendTrial({ organizationId, days, actorId: session.user.id });
  } catch (err) {
    if (err instanceof PlatformAdminError) return { error: err.message };
    throw err;
  }

  revalidatePath("/admin");
  return { error: null, saved: true };
}

export async function markSubscriptionActiveAction(organizationId: string): Promise<FormState> {
  const session = await requirePlatformAdmin();

  try {
    await markSubscriptionActive({ organizationId, actorId: session.user.id });
  } catch (err) {
    if (err instanceof PlatformAdminError) return { error: err.message };
    throw err;
  }

  revalidatePath("/admin");
  return { error: null, saved: true };
}
