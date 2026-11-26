import { prisma } from "@/lib/prisma";

/**
 * Sessions are stateless tokens, so signing out in the browser alone would leave a copied token
 * working until it expired. Ending a sign-in records its id here and the server refuses it from then on.
 * Records only need to live as long as the token could have (see SESSION_MAX_AGE_SECONDS).
 */
export async function revokeSession(sid: string, maxAgeSeconds: number): Promise<void> {
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000);
  await prisma.revokedSession.upsert({ where: { sid }, create: { sid, expiresAt }, update: {} });
  // Housekeeping: a revocation is only needed until the token would have expired anyway.
  await prisma.revokedSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}

export async function isSessionRevoked(sid: string | undefined): Promise<boolean> {
  if (!sid) return false;
  return (await prisma.revokedSession.findUnique({ where: { sid }, select: { sid: true } })) !== null;
}
