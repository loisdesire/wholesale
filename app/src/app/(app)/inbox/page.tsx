import Link from "next/link";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { formatRelativeTime } from "@/lib/format";
import { ConversationStatusBadge } from "@/components/status-badge";
import { MessageSquare, ArrowUpRight, ShoppingBag } from "lucide-react";

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
    <div className="flex flex-col gap-6 pb-12">
      {/* Header */}
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">WhatsApp Desk</h1>
            <span className="rounded-full border border-line bg-paper px-2.5 py-0.5 font-tabular text-xs font-semibold text-text-muted">
              {conversations.length} active
            </span>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            Live customer message streams, order negotiations, and catalogue inquiries.
          </p>
        </div>
      </header>

      {/* Main Table & Mobile Card View */}
      {conversations.length === 0 ? (
        <div className="card-base flex flex-col items-center justify-center rounded-2xl p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-paper text-text-muted">
            <MessageSquare className="h-6 w-6" />
          </div>
          <h2 className="mt-3 font-display text-base font-bold text-ink">No conversations active</h2>
          <p className="mt-1 max-w-sm text-xs text-text-muted">
            Incoming WhatsApp messages from registered and prospective buyers will appear here in real-time.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Mobile Card Stack (< 640px) */}
          <div className="block sm:hidden space-y-3">
            {conversations.map((c) => {
              const lastMsg = c.messages[0];
              return (
                <Link
                  key={c.id}
                  href={`/inbox/${c.id}`}
                  className="card-base block rounded-2xl p-4 shadow-xs transition-colors active:bg-paper/80"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-ink text-base truncate">
                          {c.customer.name ?? "Unnamed Customer"}
                        </span>
                      </div>
                      <p className="font-tabular text-xs text-text-muted mt-0.5">{c.customer.phone}</p>
                    </div>

                    <div className="flex flex-col items-end shrink-0 gap-1">
                      <span className="font-tabular text-xs text-text-muted">
                        {formatRelativeTime(c.lastMessageAt)}
                      </span>
                      <ConversationStatusBadge status={c.status} />
                    </div>
                  </div>

                  {/* Latest Message Preview */}
                  <div className="mt-3 rounded-xl bg-paper/60 px-3 py-2 text-xs text-ink/80 line-clamp-2">
                    {lastMsg?.body ? (
                      <span>{lastMsg.body}</span>
                    ) : (
                      <span className="italic text-text-muted/60">No message content</span>
                    )}
                  </div>

                  {/* Footer: Assigned Staff & Linked Orders */}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-2.5 text-xs text-text-muted">
                    <div className="flex items-center gap-1.5">
                      {c.assignedTo ? (
                        <span className="inline-flex items-center gap-1 text-ink font-medium text-xs">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          <span>{c.assignedTo.name}</span>
                        </span>
                      ) : (
                        <span className="text-text-muted/60 italic text-xs">Unassigned</span>
                      )}
                    </div>

                    {c.orders.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <ShoppingBag className="h-3.5 w-3.5 text-text-muted" />
                        <span className="font-tabular font-medium text-xs text-ink">
                          {c.orders.length} {c.orders.length === 1 ? "order" : "orders"}
                        </span>
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Desktop Table View (>= 640px) */}
          <div className="hidden sm:block card-base overflow-hidden rounded-2xl">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm table-fixed">
                <thead>
                  <tr className="border-b border-line bg-paper/60 text-xs font-semibold uppercase tracking-wider text-ink/80">
                    <th className="py-3.5 pl-5 pr-4 w-[220px]">Customer</th>
                    <th className="py-3.5 pr-4 w-[130px]">Status</th>
                    <th className="py-3.5 pr-4 min-w-[280px]">Latest Message</th>
                    <th className="py-3.5 pr-4 w-[160px]">Linked Orders</th>
                    <th className="py-3.5 pr-4 w-[140px]">Assigned</th>
                    <th className="py-3.5 pl-4 pr-5 text-right w-[110px]">Active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {conversations.map((c) => {
                    const lastMsg = c.messages[0];
                    return (
                      <tr
                        key={c.id}
                        className="group transition-colors hover:bg-paper/40 cursor-pointer"
                      >
                        {/* Customer Info */}
                        <td className="py-3.5 pl-5 pr-4">
                          <Link href={`/inbox/${c.id}`} className="block">
                            <p className="font-semibold text-ink group-hover:text-accent transition-colors">
                              {c.customer.name ?? "Unnamed Customer"}
                            </p>
                            <p className="font-tabular text-xs text-text-muted">{c.customer.phone}</p>
                          </Link>
                        </td>

                        {/* Status */}
                        <td className="py-3.5 pr-4 align-middle">
                          <ConversationStatusBadge status={c.status} />
                        </td>

                        {/* Latest Message snippet */}
                        <td className="py-3.5 pr-4">
                          <Link href={`/inbox/${c.id}`} className="block">
                            <p className="truncate text-xs text-ink/80 group-hover:text-ink transition-colors">
                              {lastMsg?.body ?? "—"}
                            </p>
                          </Link>
                        </td>

                        {/* Linked Orders */}
                        <td className="py-3.5 pr-4 align-middle">
                          {c.orders.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                              {c.orders.slice(0, 2).map((o) => (
                                <Link
                                  key={o.id}
                                  href={`/orders/${o.id}`}
                                  className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-xs font-bold text-ink hover:bg-accent/10 hover:text-accent transition-colors whitespace-nowrap"
                                >
                                  <span>{o.reference}</span>
                                </Link>
                              ))}
                              {c.orders.length > 2 && (
                                <span className="font-mono text-xs font-semibold text-text-muted">
                                  +{c.orders.length - 2}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-text-muted/60">—</span>
                          )}
                        </td>

                        {/* Assigned */}
                        <td className="py-3.5 pr-4 align-middle text-xs">
                          {c.assignedTo ? (
                            <span className="inline-flex items-center gap-1.5 text-ink font-medium">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              <span>{c.assignedTo.name}</span>
                            </span>
                          ) : (
                            <span className="text-text-muted/60 italic">Unassigned</span>
                          )}
                        </td>

                        {/* Last Active */}
                        <td className="py-3.5 pl-4 pr-5 text-right font-tabular text-xs text-text-muted align-middle">
                          <Link
                            href={`/inbox/${c.id}`}
                            className="inline-flex items-center gap-1 group-hover:text-accent transition-colors"
                          >
                            <span>{formatRelativeTime(c.lastMessageAt)}</span>
                            <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
