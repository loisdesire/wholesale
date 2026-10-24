"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { SlaSettingsError, updateSlaOverrides } from "@/lib/sla-settings";
import { SLA_FIELDS, type SlaKey } from "@/lib/ops-config";

export type FormState = { error: string | null; saved?: boolean };

export async function updateSlaSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");

  const overrides: Partial<Record<SlaKey, number | null>> = {};
  for (const { key } of SLA_FIELDS) {
    const raw = String(formData.get(key) ?? "").trim();
    overrides[key] = raw === "" ? null : Number(raw);
  }

  try {
    await updateSlaOverrides({ organizationId: session.user.organizationId, actor: { role: session.user.role }, overrides });
  } catch (err) {
    if (err instanceof SlaSettingsError) return { error: err.message };
    throw err;
  }

  revalidatePath("/operations");
  revalidatePath("/operations/settings");
  return { error: null, saved: true };
}
