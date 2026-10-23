import { prisma } from "@/lib/prisma";

/**
 * The membership a request should run as: the wanted organization if the user still
 * holds a membership there, otherwise their oldest remaining one, otherwise none
 * (and the session ends). Read fresh from the database on every request.
 */
export async function resolveActiveMembership(userId: string, wantedOrganizationId: string | undefined) {
  const wanted = wantedOrganizationId
    ? await prisma.membership.findUnique({
        where: { userId_organizationId: { userId, organizationId: wantedOrganizationId } },
      })
    : null;
  return (
    wanted ??
    (await prisma.membership.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } }))
  );
}
