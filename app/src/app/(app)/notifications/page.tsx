import { auth } from "@/lib/auth";
import { listNotifications } from "@/lib/notifications";
import { NotificationsView, type SerializedNotification } from "./notifications-view";

export default async function NotificationsPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId;
  const rawNotifications = await listNotifications(organizationId, session!.user.id, 100);

  // Dates are serialised for the client component.
  const initialNotifications: SerializedNotification[] = rawNotifications.map((n) => ({
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    href: n.href,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  }));

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="page-title">Notifications</h1>
      </header>
      <NotificationsView initialNotifications={initialNotifications} />
    </div>
  );
}
