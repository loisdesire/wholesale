"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth, signOut, unstable_update, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revokeSession } from "@/lib/session-revocation";

export async function signOutAction() {
  // End this sign-in on the server, not just in the browser: a copied session token stops working too.
  const session = await auth();
  if (session?.sid) await revokeSession(session.sid, SESSION_MAX_AGE_SECONDS);
  await signOut({ redirectTo: "/login" });
}

/**
 * Switches the signed-in user to another organization they belong to. The
 * membership is checked here, and again by the session callback when the token is
 * refreshed — a user can only ever land in an organization they actually hold.
 */
export async function switchOrganizationAction(organizationId: string): Promise<void> {
  const session = await auth();
  if (!session) throw new Error("Not signed in.");

  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: session.user.id, organizationId } },
  });
  if (!membership) throw new Error("You don't belong to that organization.");

  await unstable_update({ organizationId } as never);
  revalidatePath("/", "layout");
  redirect("/");
}
