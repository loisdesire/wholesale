import Link from "next/link";
import { Search } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { auth } from "@/lib/auth";
import { tenantDb } from "@/lib/db";
import { formatRelativeTime } from "@/lib/format";
import { customerMatch } from "@/lib/search";
import { ConversationStatusBadge } from "@/components/status-badge";
import { getChannelStatus } from "@/lib/channels";

// A page of conversations, not all of them: the inbox of a busy business holds thousands, and
// loading every one made the page megabytes large.
const PAGE_SIZE = 40;
const FILTERS = [
  { value: undefined, label: "All" },
  { value: "needs-reply", label: "Needs reply" },
] as const;

export const metadata = { title: "Inbox" };

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; page?: string }>;
}) {
  const params = await searchParams;
  const session = await auth();
  const organizationId = session!.user.organizationId;
  const db = tenantDb(organizationId);

  const q = params.q?.trim().slice(0, 100) || undefined;
  const filter = params.filter === "needs-reply" ? params.filter : undefined;
  const page = Math.max(1, Math.floor(Number(params.page)) || 1);

  const where = {
    organizationId,
    ...(filter ? { status: { in: ["NEW", "AWAITING_STAFF"] as ("NEW" | "AWAITING_STAFF")[] } } : {}),
    ...(q ? { customer: customerMatch(q) } : {}),
  };

  const [conversations, totalCount, totalAll, waitingCount] = await Promise.all([
    db.conversation.findMany({
      where,
      include: {
        customer: true,
        assignedTo: true,
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
        orders: { select: { reference: true }, take: 3, orderBy: { createdAt: "desc" } },
      },
      orderBy: { lastMessageAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.conversation.count({ where }),
    db.conversation.count({ where: { organizationId } }),
    db.conversation.count({ where: { organizationId, status: { in: ["NEW", "AWAITING_STAFF"] } } }),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const link = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ q, filter, ...overrides })) if (value) next.set(key, value);
    const qs = next.toString();
    return qs ? `/inbox?${qs}` : "/inbox";
  };

  // A brand-new business: say what to do, not just that nothing is here.
  if (totalAll === 0) {
    const { whatsapp, telegram } = await getChannelStatus(organizationId);
    return (
      <div className="flex flex-col gap-6">
        <header>
          <h1 className="page-title">Inbox</h1>
        </header>
        <section className="card flex max-w-2xl flex-col gap-4 p-5">
          <div>
            <h2 className="section-title">Your inbox is ready for its first chat</h2>
            <p className="mt-1 text-sm text-text-muted">Customer messages appear here as soon as a channel is connected.</p>
          </div>
          <ol className="flex flex-col gap-3 text-sm">
            <li className="flex items-start gap-3">
              <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs font-bold ${whatsapp ? "bg-accent text-white" : "border border-line text-text-muted"}`}>{whatsapp ? "✓" : "1"}</span>
              <span>
                <span className="font-semibold">WhatsApp</span> — {whatsapp ? "connected." : "not connected yet. Add your WhatsApp Business details to the server settings, then message your number to test."}
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs font-bold ${telegram ? "bg-accent text-white" : "border border-line text-text-muted"}`}>{telegram ? "✓" : "2"}</span>
              <span>
                <span className="font-semibold">Telegram</span> — {telegram ? "connected." : "optional. Add a Telegram bot token to take orders there too."}
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-line text-xs font-bold text-text-muted">3</span>
              <span>
                <Link href="/catalogue" className="link font-semibold">Add your products</Link> — the AI can only quote what is in your catalogue.
              </span>
            </li>
          </ol>
          <p className="text-sm text-text-muted">
            Want to try it before connecting a channel? <Link href="/orders/new" className="link">Create an order by hand</Link>.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="page-head">
        <div>
          <h1 className="page-title">Inbox</h1>
          <p className="mt-1 text-sm text-text-muted">
            {totalAll} conversation{totalAll === 1 ? "" : "s"}
            {waitingCount > 0 ? ` · ${waitingCount} waiting on a reply` : " · all replied to"}
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-3">
        <form action="/inbox" className="relative max-w-md">
          {filter && <input type="hidden" name="filter" value={filter} />}
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Search by name or phone"
            aria-label="Search conversations by customer name or phone"
            className="input w-full pl-9"
          />
        </form>
        <nav aria-label="Filter conversations" className="chip-row">
          {FILTERS.map((f) => {
            const active = filter === f.value;
            return (
              <Link key={f.label} href={link({ filter: f.value, page: undefined })} aria-current={active ? "true" : undefined} className={`chip ${active ? "chip-active" : ""}`}>
                {f.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {conversations.length === 0 ? (
        <p className="empty">{q || filter ? "No conversations match." : "No conversations yet."}</p>
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
                      {c.channel === "TELEGRAM" ? "Telegram" : "WhatsApp"} · {c.assignedTo?.name ?? "Unassigned"} · {formatRelativeTime(c.lastMessageAt)}
                    </p>
                  </div>
                  <div className="hidden shrink-0 flex-col items-end gap-1 text-xs text-text-muted sm:flex">
                    <span className="font-tabular">{formatRelativeTime(c.lastMessageAt)}</span>
                    <span className="flex items-center gap-1.5">
                      <span className="rounded-md bg-paper px-1.5 py-0.5 text-[11px] font-medium">{c.channel === "TELEGRAM" ? "Telegram" : "WhatsApp"}</span>
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

      {totalPages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={link({ page: String(page - 1) })} className="text-ink underline-offset-2 hover:underline">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-text-muted">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={link({ page: String(page + 1) })} className="text-ink underline-offset-2 hover:underline">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
