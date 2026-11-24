"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import { markAllNotificationsReadAction, markNotificationsReadAction } from "../operations/actions";
import { Bell, Check, CheckCheck, Loader2, RotateCcw, Search, UserCheck, Wallet } from "lucide-react";

export type SerializedNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

type FilterCategory = "ALL" | "UNREAD" | "FINANCE" | "RETURNS" | "ASSIGNMENTS";

export function NotificationsView({ initialNotifications }: { initialNotifications: SerializedNotification[] }) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<FilterCategory>("ALL");
  const [isPending, startTransition] = useTransition();
  const [markingIds, setMarkingIds] = useState<Set<string>>(new Set());

  // Metrics
  const unreadCount = useMemo(() => notifications.filter((n) => !n.readAt).length, [notifications]);
  const financeCount = useMemo(
    () => notifications.filter((n) => n.kind === "REFUND_DUE" || n.kind === "PAYMENT_VERIFIED" || n.title.toLowerCase().includes("refund") || n.title.toLowerCase().includes("payment")).length,
    [notifications]
  );
  const returnsCount = useMemo(
    () => notifications.filter((n) => n.kind.startsWith("RETURN") || n.title.toLowerCase().includes("return")).length,
    [notifications]
  );
  const assignmentsCount = useMemo(
    () => notifications.filter((n) => n.kind === "ASSIGNED" || n.title.toLowerCase().includes("assigned")).length,
    [notifications]
  );

  // Filtered Items
  const filteredNotifications = useMemo(() => {
    return notifications.filter((n) => {
      // Category filter
      if (category === "UNREAD" && n.readAt) return false;
      if (category === "FINANCE" && !(n.kind === "REFUND_DUE" || n.kind === "PAYMENT_VERIFIED" || n.title.toLowerCase().includes("refund") || n.title.toLowerCase().includes("payment"))) {
        return false;
      }
      if (category === "RETURNS" && !(n.kind.startsWith("RETURN") || n.title.toLowerCase().includes("return"))) {
        return false;
      }
      if (category === "ASSIGNMENTS" && !(n.kind === "ASSIGNED" || n.title.toLowerCase().includes("assigned"))) {
        return false;
      }

      // Search query
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesTitle = n.title.toLowerCase().includes(q);
        const matchesBody = n.body ? n.body.toLowerCase().includes(q) : false;
        const matchesKind = n.kind.toLowerCase().includes(q);
        return matchesTitle || matchesBody || matchesKind;
      }

      return true;
    });
  }, [notifications, category, search]);

  const handleMarkAllRead = () => {
    startTransition(async () => {
      await markAllNotificationsReadAction();
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() }))
      );
    });
  };

  const handleMarkSingleRead = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMarkingIds((prev) => new Set(prev).add(id));
    startTransition(async () => {
      await markNotificationsReadAction([id]);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
      );
      setMarkingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    });
  };

  function getKindMeta(n: SerializedNotification) {
    const k = n.kind.toUpperCase();
    const t = n.title.toLowerCase();
    if (k === "REFUND_DUE" || t.includes("refund")) return { icon: <Wallet size={16} />, tone: "bg-status-progress-bg text-status-progress-fg", action: "Pay refund" };
    if (k === "PAYMENT_VERIFIED" || t.includes("payment")) return { icon: <Check size={16} />, tone: "bg-status-success-bg text-status-success-fg", action: "View order" };
    if (k.startsWith("RETURN") || t.includes("return")) return { icon: <RotateCcw size={16} />, tone: "bg-status-attention-bg text-status-attention-fg", action: "Open return" };
    if (k === "ASSIGNED" || t.includes("assign")) return { icon: <UserCheck size={16} />, tone: "bg-accent-soft text-accent", action: "Open" };
    return { icon: <Bell size={16} />, tone: "bg-status-neutral-bg text-status-neutral-fg", action: "View" };
  }

  const [nowTimestamp] = useState(() => Date.now());

  function getRelativeTime(dateStr: string) {
    const diff = nowTimestamp - new Date(dateStr).getTime();
    const mins = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    return formatDateTime(new Date(dateStr)).split(",")[0];
  }

  const FILTERS: { key: FilterCategory; label: string; count: number }[] = [
    { key: "ALL", label: "All", count: notifications.length },
    { key: "UNREAD", label: "Unread", count: unreadCount },
    { key: "FINANCE", label: "Money", count: financeCount },
    { key: "RETURNS", label: "Returns", count: returnsCount },
    { key: "ASSIGNMENTS", label: "Assigned", count: assignmentsCount },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div className="relative max-w-md">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notifications"
            aria-label="Search notifications"
            className="input w-full pl-9"
          />
        </div>
        <div className="chip-row">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setCategory(f.key)}
              aria-pressed={category === f.key}
              className={`chip ${category === f.key ? "chip-active" : ""}`}
            >
              {f.label}
              <span className="font-tabular opacity-70">{f.count}</span>
            </button>
          ))}
          {unreadCount > 0 && (
            <button type="button" onClick={handleMarkAllRead} disabled={isPending} className="link self-center whitespace-nowrap pl-1 text-sm disabled:opacity-60">
              Mark all read
            </button>
          )}
        </div>
      </div>

      {filteredNotifications.length === 0 ? (
        <div className="empty">
          {notifications.length === 0 ? "Nothing yet." : "No notifications match."}
          {(search || category !== "ALL") && (
            <>
              {" "}
              <button
                type="button"
                className="link"
                onClick={() => {
                  setSearch("");
                  setCategory("ALL");
                }}
              >
                Clear filters
              </button>
            </>
          )}
        </div>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {filteredNotifications.map((n) => {
            const meta = getKindMeta(n);
            const unread = !n.readAt;
            const row = (
              <>
                <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${meta.tone}`}>{meta.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className={unread ? "font-semibold text-ink" : "text-ink"}>{n.title}</p>
                  {n.body && <p className="mt-0.5 text-text-muted">{n.body}</p>}
                  <p className="mt-1 text-xs text-text-muted">
                    {getRelativeTime(n.createdAt)}
                    {n.href && <span className="font-medium text-accent"> · {meta.action}</span>}
                  </p>
                </div>
              </>
            );
            return (
              <li key={n.id} className={`flex items-start gap-3 px-4 py-3.5 text-sm sm:px-5 ${unread ? "bg-accent-soft/60" : ""}`}>
                {n.href ? (
                  <Link href={n.href} className="flex min-w-0 flex-1 items-start gap-3">
                    {row}
                  </Link>
                ) : (
                  <div className="flex min-w-0 flex-1 items-start gap-3">{row}</div>
                )}
                {unread && (
                  <button
                    type="button"
                    onClick={(e) => handleMarkSingleRead(n.id, e)}
                    disabled={markingIds.has(n.id)}
                    aria-label="Mark as read"
                    title="Mark as read"
                    className="mt-1 shrink-0 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-paper hover:text-ink disabled:opacity-60"
                  >
                    {markingIds.has(n.id) ? <Loader2 size={16} className="animate-spin" /> : <CheckCheck size={16} />}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
