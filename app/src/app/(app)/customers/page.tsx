import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function CustomersPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId;

  const customers = await prisma.customer.findMany({
    where: { organizationId },
    include: { _count: { select: { orders: true, conversations: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-medium text-ink">Customers</h1>
        <p className="mt-1 text-sm text-text-muted">
          Identified by phone number, with their order and conversation history.
        </p>
      </header>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
            <th className="py-2 pr-4">Name</th>
            <th className="py-2 pr-4">Phone</th>
            <th className="py-2 pr-4">Notes</th>
            <th className="py-2 pr-4 text-right">Conversations</th>
            <th className="py-2 pr-4 text-right">Orders</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c) => (
            <tr key={c.id} className="border-b border-line last:border-0">
              <td className="py-3 pr-4 text-ink">{c.name ?? "Unnamed"}</td>
              <td className="py-3 pr-4 font-tabular text-text-muted">{c.phone}</td>
              <td className="py-3 pr-4 max-w-sm truncate text-text-muted">
                {c.notes ?? "—"}
              </td>
              <td className="py-3 pr-4 text-right font-tabular text-ink">
                {c._count.conversations}
              </td>
              <td className="py-3 pr-4 text-right font-tabular text-ink">
                {c._count.orders}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
