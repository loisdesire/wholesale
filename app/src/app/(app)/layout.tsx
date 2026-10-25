import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { unreadCount } from "@/lib/notifications";
import { Nav } from "@/components/nav";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await auth();
  // The organizations this user belongs to (identity data, not tenant data).
  const [memberships, unread] = await Promise.all([
    session
      ? prisma.membership.findMany({
          where: { userId: session.user.id },
          include: { organization: true },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
    session ? unreadCount(session.user.organizationId, session.user.id) : Promise.resolve(0),
  ]);
  const active = memberships.find((m) => m.organizationId === session?.user.organizationId);

  return (
    <div className="flex min-h-screen">
      <Nav
        orgName={active?.organization.name ?? "Wholesale"}
        userName={session?.user.name ?? ""}
        userRole={session?.user.role ?? "STAFF"}
        organizations={memberships.map((m) => ({ id: m.organizationId, name: m.organization.name, role: m.role }))}
        activeOrganizationId={session?.user.organizationId ?? ""}
        unreadNotifications={unread}
        isPlatformAdmin={session?.user.isPlatformAdmin ?? false}
      />
      <main className="flex-1 overflow-y-auto px-10 py-8">{children}</main>
    </div>
  );
}
