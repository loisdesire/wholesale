"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { deleteReportView, ReportViewError, saveReportView } from "@/lib/report-views";

export type FormState = { error: string | null; saved?: boolean };

export async function saveReportViewAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");

  const name = String(formData.get("name") ?? "");
  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "");

  try {
    await saveReportView({
      organizationId: session.user.organizationId,
      createdById: session.user.id,
      name,
      from: new Date(from),
      to: new Date(to),
    });
  } catch (err) {
    if (err instanceof ReportViewError) return { error: err.message };
    throw err;
  }

  revalidatePath("/reports");
  return { error: null, saved: true };
}

export async function deleteReportViewAction(id: string): Promise<FormState> {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");

  try {
    await deleteReportView({ organizationId: session.user.organizationId, id });
  } catch (err) {
    if (err instanceof ReportViewError) return { error: err.message };
    throw err;
  }

  revalidatePath("/reports");
  return { error: null, saved: true };
}
