import { prisma } from "@/lib/prisma";

/**
 * Resolves which organization an inbound Telegram message belongs to.
 * Matches by telegramBotToken if multiple exist, or defaults to the primary organization.
 */
export async function resolveOrganizationForTelegram(tokenOverride?: string | null) {
  if (tokenOverride) {
    const org = await prisma.organization.findFirst({
      where: { telegramBotToken: tokenOverride },
    });
    if (org) return org;
  }

  const organizations = await prisma.organization.findMany({ take: 2 });
  if (organizations.length >= 1) {
    return organizations[0];
  }
  return null;
}
