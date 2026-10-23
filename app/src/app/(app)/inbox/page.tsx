import Link from "next/link";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { formatRelativeTime } from "@/lib/format";
import { ConversationStatusBadge } from "@/components/status-badge";

export default async function InboxPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId;
  const db = tenantDb(organizationId);

  const conversations = await db.conversation.findMany({
    where: { organizationId },
    include: {
      customer: true,
      assignedTo: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
      orders: true,
    },
    orderBy: { lastMessageAt: "desc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-medium text-ink">Inbox</h1>
        <p className="mt-1 text-sm text-text-muted">
          Every WhatsApp conversation, regardless of who or what is handling it.
        </p>
      </header>

      {conversations.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-text-muted">
          No conversations yet.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
              <th className="py-2 pr-4">Customer</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Last message</th>
              <th className="py-2 pr-4">Orders</th>
              <th className="py-2 pr-4">Assigned</th>
              <th className="py-2 pr-4 text-right">Updated</th>
            </tr>
          </thead>
          <tbody>
            {conversations.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-0">
                <td className="py-3 pr-4">
                  <Link href={`/inbox/${c.id}`} className="block hover:underline">
                    <p className="font-medium text-ink">{c.customer.name ?? "Unnamed"}</p>
                    <p className="font-tabular text-xs text-text-muted">{c.customer.phone}</p>
                  </Link>
                </td>
                <td className="py-3 pr-4">
                  <ConversationStatusBadge status={c.status} />
                </td>
                <td className="py-3 pr-4 max-w-xs truncate text-text-muted">
                  {c.messages[0]?.body ?? "—"}
                </td>
                <td className="py-3 pr-4 text-text-muted">
                  {c.orders.length > 0 ? c.orders.map((o) => o.reference).join(", ") : "—"}
                </td>
                <td className="py-3 pr-4 text-text-muted">
                  {c.assignedTo?.name ?? "Unassigned"}
                </td>
                <td className="py-3 pr-4 text-right font-tabular text-xs text-text-muted">
                  {formatRelativeTime(c.lastMessageAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
