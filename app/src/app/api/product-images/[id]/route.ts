import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";

/**
 * Streams a product photo's bytes — same shape as /api/attachments/[id]. ProductImage has no
 * organizationId of its own (a child of Product, same pattern as PriceTier); RLS alone is what
 * stops this from serving another organization's image.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) {
    return new Response("Not signed in", { status: 401 });
  }

  const { id } = await params;
  const image = await tenantDb(session.user.organizationId).productImage.findUnique({ where: { id } });
  if (!image) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.mimeType,
      "Content-Length": String(image.sizeBytes),
      "Cache-Control": "private, max-age=86400",
    },
  });
}
