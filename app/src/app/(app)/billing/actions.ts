"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { Plan } from "@prisma/client";
import { initializeSubscriptionPayment } from "@/lib/billing";
import { PaystackError } from "@/lib/payments";
import { prisma } from "@/lib/prisma";
import { reconcileProviderPayments, type ReconciliationResult } from "@/lib/reconciliation";

export type SubscriptionLinkState = { error: string | null; authorizationUrl?: string };

/** Starts a Paystack payment for one period of the given plan and returns the hosted page link. */
export async function getSubscriptionPaymentLinkAction(plan: Plan): Promise<SubscriptionLinkState> {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");
  if (session.user.role !== "OWNER") return { error: "Only an owner can manage billing." };

  const organizationId = session.user.organizationId;
  try {
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });
    const { authorizationUrl } = await initializeSubscriptionPayment({ organizationId, plan, ownerEmail: owner.email });
    revalidatePath("/billing");
    return { error: null, authorizationUrl };
  } catch (err) {
    if (err instanceof PaystackError) return { error: err.message };
    throw err;
  }
}

export type ReconciliationState = { error: string | null; result?: ReconciliationResult };

/** Compares Paystack's own record of what it successfully charged against what this app recorded. */
export async function runReconciliationAction(): Promise<ReconciliationState> {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");
  if (session.user.role !== "OWNER") return { error: "Only an owner can run reconciliation." };

  try {
    const result = await reconcileProviderPayments(session.user.organizationId);
    return { error: null, result };
  } catch (err) {
    if (err instanceof PaystackError) return { error: err.message };
    throw err;
  }
}
