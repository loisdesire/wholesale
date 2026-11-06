import { auth } from "@/lib/auth";
import { listNotifications } from "@/lib/notifications";
import { NotificationsView, type SerializedNotification } from "./notifications-view";
import { Bell } from "lucide-react";

export default async function NotificationsPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId;
  const rawNotifications = await listNotifications(organizationId, session!.user.id, 100);

  // Serialize Date objects safely for client component
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
    <div className="mx-auto flex max-w-5xl flex-col gap-6 pb-12">
      {/* Top Header */}
      <header className="flex flex-col gap-1.5 border-b border-line pb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-paper shadow-sm">
            <Bell className="h-4 w-4" />
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Activity &amp; Operational Alerts
          </h1>
        </div>
        <p className="text-sm text-text-muted">
          Real-time alerts for customer returns, verified Paystack payments, pending refund liabilities, and order assignments.
        </p>
      </header>

      {/* Interactive Activity Center */}
      <NotificationsView initialNotifications={initialNotifications} />
    </div>
  );
}
