"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import { markAllNotificationsReadAction, markNotificationsReadAction } from "../operations/actions";
import { 
  Bell, 
  CheckCheck, 
  RotateCcw, 
  DollarSign, 
  UserCheck, 
  Search, 
  Check, 
  ArrowUpRight, 
  Loader2, 
  Inbox, 
  Clock
} from "lucide-react";

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

    if (k === "REFUND_DUE" || t.includes("refund")) {
      return {
        badge: "Refund Required",
        badgeClass: "bg-amber-500/10 text-amber-700 border-amber-500/20",
        borderClass: "border-l-amber-500",
        icon: <DollarSign className="h-4 w-4 text-amber-600" />,
        actionText: "Process Refund",
      };
    }
    if (k === "PAYMENT_VERIFIED" || t.includes("payment")) {
      return {
        badge: "Payment Verified",
        badgeClass: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
        borderClass: "border-l-emerald-500",
        icon: <Check className="h-4 w-4 text-emerald-600" />,
        actionText: "View Order",
      };
    }
    if (k.startsWith("RETURN") || t.includes("return")) {
      return {
        badge: "Return Triage",
        badgeClass: "bg-rose-500/10 text-rose-700 border-rose-500/20",
        borderClass: "border-l-rose-500",
        icon: <RotateCcw className="h-4 w-4 text-rose-600" />,
        actionText: "Inspect Return",
      };
    }
    if (k === "ASSIGNED" || t.includes("assign")) {
      return {
        badge: "Assignment",
        badgeClass: "bg-accent/10 text-accent border-accent/20",
        borderClass: "border-l-accent",
        icon: <UserCheck className="h-4 w-4 text-accent" />,
        actionText: "Open Task",
      };
    }
    return {
      badge: "Operational Notice",
      badgeClass: "bg-ink/5 text-ink border-ink/10",
      borderClass: "border-l-ink/40",
      icon: <Bell className="h-4 w-4 text-ink" />,
      actionText: "View Details",
    };
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

  return (
    <div className="flex flex-col gap-6">
      {/* 4 KPI Summary Cards */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Unread Alerts */}
        <div 
          onClick={() => setCategory("UNREAD")}
          className={`card-base p-4 cursor-pointer transition-all hover:border-ink ${
            category === "UNREAD" ? "ring-2 ring-accent border-accent" : ""
          }`}
        >
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink/80">Unread Alerts</span>
            <div className={`h-2 w-2 rounded-full ${unreadCount > 0 ? "bg-accent animate-pulse" : "bg-text-muted/30"}`} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={`font-display text-2xl font-bold ${unreadCount > 0 ? "text-accent" : "text-ink"}`}>
              {unreadCount}
            </span>
            <span className="text-xs text-text-muted">pending</span>
          </div>
        </div>

        {/* Financial & Refunds */}
        <div 
          onClick={() => setCategory("FINANCE")}
          className={`card-base p-4 cursor-pointer transition-all hover:border-ink ${
            category === "FINANCE" ? "ring-2 ring-accent border-accent" : ""
          }`}
        >
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink/80">Finance &amp; Refunds</span>
            <DollarSign className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold text-ink">{financeCount}</span>
            <span className="text-xs text-text-muted">events</span>
          </div>
        </div>

        {/* Returns */}
        <div 
          onClick={() => setCategory("RETURNS")}
          className={`card-base p-4 cursor-pointer transition-all hover:border-ink ${
            category === "RETURNS" ? "ring-2 ring-accent border-accent" : ""
          }`}
        >
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink/80">Returns Triage</span>
            <RotateCcw className="h-4 w-4 text-rose-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold text-ink">{returnsCount}</span>
            <span className="text-xs text-text-muted">requests</span>
          </div>
        </div>

        {/* Assignments */}
        <div 
          onClick={() => setCategory("ASSIGNMENTS")}
          className={`card-base p-4 cursor-pointer transition-all hover:border-ink ${
            category === "ASSIGNMENTS" ? "ring-2 ring-accent border-accent" : ""
          }`}
        >
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink/80">My Assignments</span>
            <UserCheck className="h-4 w-4 text-accent" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold text-ink">{assignmentsCount}</span>
            <span className="text-xs text-text-muted">assigned</span>
          </div>
        </div>
      </section>

      {/* Filter & Search Toolbar */}
      <div className="card-base p-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Category Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: "ALL", label: "All Notices", count: notifications.length },
              { id: "UNREAD", label: "Unread", count: unreadCount },
              { id: "FINANCE", label: "Finance", count: financeCount },
              { id: "RETURNS", label: "Returns", count: returnsCount },
              { id: "ASSIGNMENTS", label: "Assigned", count: assignmentsCount },
            ] as const
          ).map((t) => {
            const active = category === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setCategory(t.id)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  active
                    ? "bg-ink text-paper shadow-xs"
                    : "bg-surface text-text-muted hover:bg-paper hover:text-ink border border-line"
                }`}
              >
                <span>{t.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold font-tabular ${
                    active ? "bg-white/20 text-white" : "bg-line/50 text-text-muted"
                  }`}
                >
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Right Tools: Search & Mark All */}
        <div className="flex items-center gap-2">
          <div className="relative min-w-[180px] flex-1 sm:flex-none">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notifications…"
              className="w-full rounded-md border border-line bg-surface py-1.5 pl-8 pr-3 text-xs text-ink placeholder:text-text-muted/60 outline-none focus:border-ink focus:ring-1 focus:ring-ink"
            />
          </div>

          {unreadCount > 0 && (
            <button
              type="button"
              disabled={isPending}
              onClick={handleMarkAllRead}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-all hover:bg-paper active:scale-95 disabled:opacity-60 shrink-0"
              title="Mark all notifications as read"
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCheck className="h-3.5 w-3.5 text-accent" />
              )}
              <span>Mark all read</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Notification Card Feed */}
      {filteredNotifications.length === 0 ? (
        <div className="card-base p-16 text-center flex flex-col items-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-paper text-text-muted/50 mb-3">
            <Inbox className="h-6 w-6" />
          </div>
          <h3 className="font-display text-base font-semibold text-ink">No notifications found</h3>
          <p className="mt-1 text-xs text-text-muted max-w-sm">
            {search || category !== "ALL"
              ? "No alerts match your current filter settings. Try clearing the search query or selecting 'All Notices'."
              : "You are completely up to date. You have no pending operational alerts or task assignments."}
          </p>
          {(search || category !== "ALL") && (
            <button
              type="button"
              onClick={() => {
                setCategory("ALL");
                setSearch("");
              }}
              className="mt-3 text-xs font-semibold text-accent underline underline-offset-2 hover:text-accent-2"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {filteredNotifications.map((n) => {
            const isUnread = !n.readAt;
            const meta = getKindMeta(n);
            const isMarking = markingIds.has(n.id);

            return (
              <div
                key={n.id}
                className={`card-base relative overflow-hidden transition-all hover:shadow-md border-l-4 ${
                  meta.borderClass
                } ${isUnread ? "bg-white ring-1 ring-accent/15" : "bg-surface/80"}`}
              >
                <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  {/* Left Content Area */}
                  <div className="flex items-start gap-3.5 flex-1 min-w-0">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-paper/60 shadow-xs">
                      {meta.icon}
                    </div>

                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${meta.badgeClass}`}>
                          {meta.badge}
                        </span>
                        {isUnread && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-white shadow-xs">
                            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                            New
                          </span>
                        )}
                        <span className="text-xs text-text-muted font-tabular flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {getRelativeTime(n.createdAt)}
                        </span>
                      </div>

                      <h4 className={`mt-1.5 text-sm ${isUnread ? "font-semibold text-ink" : "font-medium text-ink"}`}>
                        {n.title}
                      </h4>

                      {n.body && (
                        <p className="mt-1 text-xs text-text-muted leading-relaxed line-clamp-2">
                          {n.body}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Right Actions Area */}
                  <div className="flex items-center justify-end gap-2 self-end sm:self-center shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 w-full sm:w-auto">
                    {/* Mark Read Toggle if Unread */}
                    {isUnread && (
                      <button
                        type="button"
                        disabled={isMarking}
                        onClick={(e) => handleMarkSingleRead(n.id, e)}
                        className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-text-muted hover:text-ink hover:bg-paper transition-all"
                        title="Mark as read"
                      >
                        {isMarking ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Check className="h-3 w-3 text-emerald-600" />
                        )}
                        <span>Dismiss</span>
                      </button>
                    )}

                    {/* Open Reference Link */}
                    {n.href && (
                      <Link
                        href={n.href}
                        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                          isUnread
                            ? "bg-ink text-paper hover:bg-ink/90 shadow-xs"
                            : "bg-paper text-ink hover:bg-paper-2 border border-line"
                        }`}
                      >
                        <span>{meta.actionText}</span>
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
