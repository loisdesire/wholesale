import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Nav } from "@/components/nav";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await auth();
  // The organizations this user belongs to (identity data, not tenant data).
  const memberships = session
    ? await prisma.membership.findMany({
        where: { userId: session.user.id },
        include: { organization: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const active = memberships.find((m) => m.organizationId === session?.user.organizationId);

  return (
    <div className="flex min-h-screen">
      <Nav
        orgName={active?.organization.name ?? "Wholesale"}
        userName={session?.user.name ?? ""}
        userRole={session?.user.role ?? "STAFF"}
        organizations={memberships.map((m) => ({ id: m.organizationId, name: m.organization.name, role: m.role }))}
        activeOrganizationId={session?.user.organizationId ?? ""}
      />
      <main className="flex-1 overflow-y-auto px-10 py-8">{children}</main>
    </div>
  );
}
