import Link from "next/link";
import { Bell } from "lucide-react";
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
      <header className="page-head">
        <div>
          <h1 className="page-title">Notifications</h1>
        </div>
        {unreadIds.length > 0 && <MarkAllReadButton />}
      </header>

      {notifications.length === 0 ? (
        <p className="empty">
          Nothing yet.
        </p>
      ) : (
        <div className="card divide-y divide-line overflow-hidden">
          {notifications.map((n) => (
            <Link
              key={n.id}
              href={n.href ?? "#"}
              className={`flex items-start gap-3.5 px-4 py-3.5 text-sm transition-colors hover:bg-paper/70 sm:px-5 ${!n.readAt ? "bg-accent-soft/60" : ""}`}
            >
              <span
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                  !n.readAt ? "bg-accent text-white" : "bg-paper text-text-muted"
                }`}
              >
                <Bell size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <p className={!n.readAt ? "font-semibold text-ink" : "text-ink"}>{n.title}</p>
                {n.body && <p className="mt-0.5 text-text-muted">{n.body}</p>}
                <p className="mt-1 text-xs text-text-muted sm:hidden">{formatDateTime(n.createdAt)}</p>
              </div>
              <span className="hidden whitespace-nowrap text-xs text-text-muted sm:block">{formatDateTime(n.createdAt)}</span>
              {!n.readAt && <span aria-label="Unread" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />}
            </Link>
          ))}
        </div>
      )}

      {/* Viewing this page marks the currently-unread notices read. */}
      <MarkReadOnView ids={unreadIds} />
    </div>
  );
}
