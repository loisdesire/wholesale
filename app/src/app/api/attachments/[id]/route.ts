import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";

/**
 * Streams a stored inbound image's bytes. MessageAttachment has no organizationId of its own —
 * it's a child of Message, which is a child of Conversation (see docs/ISOLATION.md) — so there's
 * no application-level `where: { organizationId }` to add here; row-level security alone is what
 * stops this from serving another organization's attachment, exactly like OrderItem/PriceTier
 * elsewhere in this app. tenantDb() still sets the session's app.organization_id first, which is
 * what makes that enforcement apply at all.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) {
    return new Response("Not signed in", { status: 401 });
  }

  const { id } = await params;
  const attachment = await tenantDb(session.user.organizationId).messageAttachment.findUnique({ where: { id } });
  if (!attachment) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(attachment.data), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(attachment.sizeBytes),
      // Private — never cached by a shared/CDN cache, since this is tenant-private content
      // served from an authenticated route, not a public asset.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
