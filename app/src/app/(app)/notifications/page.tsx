import Link from "next/link";
import { auth } from "@/lib/auth";
import { listNotifications } from "@/lib/notifications";
import { formatDateTime } from "@/lib/format";
import { MarkAllReadButton, MarkReadOnView } from "./notifications-ui";

export default async function NotificationsPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId;
  const notifications = await listNotifications(organizationId, session!.user.id);
  const unreadIds = notifications.filter((n) => !n.readAt).map((n) => n.id);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Notifications</h1>
          <p className="mt-1 text-sm text-text-muted">Return decisions, refunds due, and work assigned to you.</p>
        </div>
        {unreadIds.length > 0 && <MarkAllReadButton />}
      </header>

      {notifications.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-text-muted">
          Nothing yet.
        </p>
      ) : (
        <div className="divide-y divide-line rounded-md border border-line bg-surface">
          {notifications.map((n) => (
            <Link
              key={n.id}
              href={n.href ?? "#"}
              className={`flex items-start justify-between gap-4 px-4 py-3 text-sm hover:bg-paper ${!n.readAt ? "bg-status-neutral-bg/40" : ""}`}
            >
              <div>
                <p className={!n.readAt ? "font-medium text-ink" : "text-ink"}>{n.title}</p>
                {n.body && <p className="mt-0.5 text-text-muted">{n.body}</p>}
              </div>
              <span className="whitespace-nowrap text-xs text-text-muted">{formatDateTime(n.createdAt)}</span>
            </Link>
          ))}
        </div>
      )}

      {/* Viewing this page marks the currently-unread notices read. */}
      <MarkReadOnView ids={unreadIds} />
    </div>
  );
}
