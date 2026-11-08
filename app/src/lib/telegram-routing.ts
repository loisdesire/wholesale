import { prisma } from "@/lib/prisma";

/**
 * Which organization an inbound Telegram message belongs to.
 *
 * Each organization registers the Telegram bot token it receives on
 * (`Organization.telegramBotToken`). A message is routed to the organization
 * that owns the token — never to "whichever organization comes first".
 *
 * The one exception is a single-tenant install that has not registered a token:
 * with exactly one organization and no registered tokens anywhere, there is nobody
 * else it could belong to.
 *
 * If more than one organization exists, or if tokens are registered, any message
 * that cannot be attributed with 100% certainty to a specific organization is
 * unroutable and returns null, refusing to guess rather than leak one tenant's
 * customer into another tenant's inbox.
 */
export async function resolveOrganizationForTelegram(tokenOrSecret?: string | null) {
  if (tokenOrSecret) {
    const owner = await prisma.organization.findFirst({
      where: { telegramBotToken: tokenOrSecret },
    });
    if (owner) return owner;
  }

  const [organizations, registered] = await Promise.all([
    prisma.organization.findMany({ take: 2 }),
    prisma.organization.count({ where: { telegramBotToken: { not: null } } }),
  ]);

  if (organizations.length === 1 && registered === 0) {
    return organizations[0];
  }

  return null;
}
