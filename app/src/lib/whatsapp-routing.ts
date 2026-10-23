import { prisma } from "@/lib/prisma";

/**
 * Which organization an inbound WhatsApp message belongs to.
 *
 * Each organization registers the WhatsApp business phone number it receives on
 * (`Organization.whatsappPhoneNumberId`); Meta puts that id on every webhook. A
 * message is routed to the organization that owns the number — never to "whichever
 * organization comes first". The one exception is a single-tenant install that has
 * not registered a number: with exactly one organization and no registered numbers
 * anywhere, there is nobody else it could belong to. Anything else is unroutable and
 * returns null, so the caller can refuse it rather than file it under the wrong tenant.
 */
export async function resolveOrganizationForWhatsApp(phoneNumberId: string | undefined) {
  if (phoneNumberId) {
    const owner = await prisma.organization.findUnique({ where: { whatsappPhoneNumberId: phoneNumberId } });
    if (owner) return owner;
  }

  const [organizations, registered] = await Promise.all([
    prisma.organization.findMany({ take: 2 }),
    prisma.organization.count({ where: { whatsappPhoneNumberId: { not: null } } }),
  ]);
  if (organizations.length === 1 && registered === 0) return organizations[0];
  return null;
}
