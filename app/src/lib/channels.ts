import { prisma } from "@/lib/prisma";
import { isWhatsAppConfigured } from "@/lib/whatsapp";

/**
 * Which channels THIS business has connected. The server holds shared WhatsApp credentials, but a
 * business only receives messages once its own number (or Telegram bot) is registered to it, so a
 * server-wide "configured" flag alone would wrongly show a brand-new business as connected.
 */
export async function getChannelStatus(organizationId: string): Promise<{ whatsapp: boolean; telegram: boolean }> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { whatsappPhoneNumberId: true, telegramBotToken: true } });
  return {
    whatsapp: Boolean(org?.whatsappPhoneNumberId) && isWhatsAppConfigured(),
    telegram: Boolean(org?.telegramBotToken),
  };
}
