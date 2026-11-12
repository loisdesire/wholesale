import Link from "next/link";
import { Avatar } from "@/components/avatar";
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
        <h1 className="page-title">Inbox</h1>
      </header>

      {conversations.length === 0 ? (
        <p className="empty">
          No conversations yet.
        </p>
      ) : (
        // A conversation list, not a spreadsheet: who, what they last said, and whether it's
        // waiting on us. Rows that need a person carry a cobalt marker on the left edge.
        <ul className="card divide-y divide-line overflow-hidden">
          {conversations.map((c) => {
            const waiting = c.status === "AWAITING_STAFF" || c.status === "NEW";
            const name = c.customer.name ?? "Unnamed";
            return (
              <li key={c.id} className="relative">
                <Link
                  href={`/inbox/${c.id}`}
                  className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-paper/70 sm:items-center sm:px-5"
                >
                  <span className="relative shrink-0">
                    <Avatar name={c.customer.name ?? c.customer.phone} />
                    {waiting && <span aria-label="Waiting on a reply" className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-surface bg-accent" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={`text-sm text-ink ${waiting ? "font-semibold" : "font-medium"}`}>{name}</span>
                      <ConversationStatusBadge status={c.status} />
                      {c.orders.map((o) => (
                        <span key={o.reference} className="rounded-md bg-paper px-1.5 py-0.5 font-mono text-[11px] text-text-muted">
                          {o.reference}
                        </span>
                      ))}
                    </div>
                    <p className={`mt-0.5 truncate text-sm ${waiting ? "text-ink" : "text-text-muted"}`}>
                      {c.messages[0]?.body ?? "No messages yet"}
                    </p>
                    <p className="mt-0.5 text-xs text-text-muted sm:hidden">
                      {c.assignedTo?.name ?? "Unassigned"} · {formatRelativeTime(c.lastMessageAt)}
                    </p>
                  </div>
                  <div className="hidden shrink-0 flex-col items-end gap-1 text-xs text-text-muted sm:flex">
                    <span className="font-tabular">{formatRelativeTime(c.lastMessageAt)}</span>
                    <span className="flex items-center gap-1.5">
                      {c.assignedTo?.name ? (
                        <>
                          <Avatar name={c.assignedTo.name} size="xs" />
                          {c.assignedTo.name}
                        </>
                      ) : (
                        "Unassigned"
                      )}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
