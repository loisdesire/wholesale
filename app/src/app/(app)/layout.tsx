import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Nav } from "@/components/nav";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await auth();
  const organization = session?.user.organizationId
    ? await prisma.organization.findUnique({
        where: { id: session.user.organizationId },
      })
    : null;

  return (
    <div className="flex min-h-screen">
      <Nav
        orgName={organization?.name ?? "Adaeze Wholesale"}
        userName={session?.user.name ?? ""}
        userRole={session?.user.role ?? "STAFF"}
      />
      <main className="flex-1 overflow-y-auto px-10 py-8">{children}</main>
    </div>
  );
}
