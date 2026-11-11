"use client";

import { useState, useMemo } from "react";
import { PLAN_LIMITS } from "@/lib/billing";
import { formatDateTime } from "@/lib/format";
import { SubscriptionStatusBadge } from "@/components/status-badge";
import { AdminRowActions } from "./row-actions";
import type { PlatformOrganizationOverview } from "@/lib/platform-admin";
import { 
  Search, 
  Building2, 
  Calendar, 
  Users, 
  ShoppingBag, 
  Sparkles, 
  Clock, 
  AlertTriangle,
  ArrowUpDown
} from "lucide-react";

type Props = {
  overview: PlatformOrganizationOverview[];
};

type StatusFilter = "ALL" | "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELED";

export function AdminTable({ overview }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [sortField, setSortField] = useState<"name" | "createdAt" | "orders">("name");
  const [sortAsc, setSortAsc] = useState(true);

  // Status counts
  const counts = useMemo(() => {
    return {
      ALL: overview.length,
      ACTIVE: overview.filter((o) => o.subscriptionStatus === "ACTIVE").length,
      TRIALING: overview.filter((o) => o.subscriptionStatus === "TRIALING").length,
      PAST_DUE: overview.filter((o) => o.subscriptionStatus === "PAST_DUE").length,
      CANCELED: overview.filter((o) => o.subscriptionStatus === "CANCELED").length,
    };
  }, [overview]);

  // Filtered and sorted data
  const filtered = useMemo(() => {
    return overview
      .filter((org) => {
        if (statusFilter !== "ALL" && org.subscriptionStatus !== statusFilter) {
          return false;
        }
        if (search.trim()) {
          const q = search.toLowerCase().trim();
          return (
            org.name.toLowerCase().includes(q) ||
            org.id.toLowerCase().includes(q) ||
            PLAN_LIMITS[org.plan].label.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        let cmp = 0;
        if (sortField === "name") {
          cmp = a.name.localeCompare(b.name);
        } else if (sortField === "createdAt") {
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        } else if (sortField === "orders") {
          cmp = a.ordersThisPeriod - b.ordersThisPeriod;
        }
        return sortAsc ? cmp : -cmp;
      });
  }, [overview, search, statusFilter, sortField, sortAsc]);

  function toggleSort(field: "name" | "createdAt" | "orders") {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  }

  const [currentTimestamp] = useState(() => Date.now());

  function getRunwayLabel(org: PlatformOrganizationOverview) {
    if (org.subscriptionStatus === "TRIALING" && org.trialEndsAt) {
      const msLeft = new Date(org.trialEndsAt).getTime() - currentTimestamp;
      const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
      if (daysLeft < 0) {
        return (
          <span className="inline-flex items-center gap-1 rounded bg-status-attention-bg px-1.5 py-0.5 text-xs font-medium text-status-attention-fg">
            <AlertTriangle className="h-3 w-3" /> Trial expired
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1 text-xs text-text-muted">
          <Clock className="h-3 w-3 text-status-progress-fg" />
          <span className="font-medium text-ink">{daysLeft}d runway</span>
          <span className="text-xs text-text-muted">({formatDateTime(org.trialEndsAt).split(",")[0]})</span>
        </span>
      );
    }

    if (org.currentPeriodEnd) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-text-muted">
          <Calendar className="h-3 w-3 text-text-muted" />
          <span>Renews {formatDateTime(org.currentPeriodEnd).split(",")[0]}</span>
        </span>
      );
    }

    return <span className="text-xs text-text-muted">—</span>;
  }

  return (
    <div className="card-base overflow-hidden">
      {/* Table Toolbar */}
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Status Filter Tabs — plain underline, not filled pills */}
        <nav className="flex flex-wrap items-center gap-5 text-xs font-semibold">
          {(["ALL", "ACTIVE", "TRIALING", "PAST_DUE"] as const).map((key) => {
            const count = counts[key];
            const isActive = statusFilter === key;
            const labels: Record<StatusFilter, string> = {
              ALL: "All tenants",
              ACTIVE: "Active",
              TRIALING: "Trialing",
              PAST_DUE: "Past due",
              CANCELED: "Canceled",
            };

            return (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={`border-b-2 pb-0.5 transition-colors ${
                  isActive ? "border-accent text-ink" : "border-transparent text-text-muted hover:text-ink"
                }`}
              >
                {labels[key]} <span className="font-tabular font-normal">({count})</span>
              </button>
            );
          })}
        </nav>

        {/* Search Input */}
        <div className="relative min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter organizations…"
            className="w-full border border-line bg-surface py-2 sm:py-1.5 pl-8 pr-3 text-base sm:text-xs text-ink placeholder:text-text-muted/60 outline-none focus:border-ink focus:ring-1 focus:ring-ink"
          />
        </div>
      </div>

      {/* Main Table */}
      {filtered.length === 0 ? (
        <div className="p-12 text-center">
          <Building2 className="mx-auto h-8 w-8 text-text-muted/40" />
          <p className="mt-2 text-sm font-medium text-ink">No organizations match filter</p>
          <p className="mt-1 text-xs text-text-muted">
            Try adjusting your search query or switching the status filter tab above.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
                <th className="w-56 px-4 py-3">
                  <button
                    onClick={() => toggleSort("name")}
                    className="inline-flex items-center gap-1 hover:text-ink transition-colors"
                  >
                    <span>Organization</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="w-28 px-4 py-3">Plan</th>
                <th className="w-28 px-4 py-3">Status</th>
                <th className="w-44 px-4 py-3">Runway / cycle</th>
                <th className="w-28 px-4 py-3 text-right">
                  <span className="inline-flex items-center justify-end gap-1">
                    <Users className="h-3 w-3" /> Seats
                  </span>
                </th>
                <th className="w-32 px-4 py-3 text-right">
                  <button
                    onClick={() => toggleSort("orders")}
                    className="inline-flex items-center justify-end gap-1 hover:text-ink transition-colors ml-auto"
                  >
                    <ShoppingBag className="h-3 w-3" />
                    <span>Orders (mo)</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="w-32 px-4 py-3 text-right">
                  <span className="inline-flex items-center justify-end gap-1">
                    <Sparkles className="h-3 w-3" /> AI usage
                  </span>
                </th>
                <th className="w-60 px-4 py-3 text-right sticky right-0 z-10 bg-surface border-l border-line/60">
                  Support action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((org) => {
                const planLimit = PLAN_LIMITS[org.plan];
                const seatsExceeded = org.staffSeats > planLimit.staffSeats;
                const ordersExceeded = org.ordersThisPeriod > planLimit.ordersPerMonth;
                const aiExceeded = org.aiRepliesThisPeriod > planLimit.aiRepliesPerMonth;

                const seatsPct = Math.min(100, Math.round((org.staffSeats / planLimit.staffSeats) * 100));
                const ordersPct = Math.min(100, Math.round((org.ordersThisPeriod / planLimit.ordersPerMonth) * 100));
                const aiPct = Math.min(100, Math.round((org.aiRepliesThisPeriod / planLimit.aiRepliesPerMonth) * 100));

                return (
                  <tr key={org.id} className="transition-colors hover:bg-paper/20">
                    {/* Organization Name & ID */}
                    <td className="px-4 py-3.5 align-middle">
                      <div className="flex flex-col">
                        <span className="font-medium text-ink truncate" title={org.name}>
                          {org.name}
                        </span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-xs text-text-muted select-all">
                            {org.id.slice(0, 12)}…
                          </span>
                          <span className="text-xs text-text-muted">
                            Joined {formatDateTime(org.createdAt).split(",")[0]}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Plan */}
                    <td className="px-4 py-3.5 align-middle">
                      <span className="inline-flex items-center rounded-md border border-line bg-paper/50 px-2 py-0.5 text-xs font-medium text-ink">
                        {planLimit.label}
                      </span>
                    </td>

                    {/* Subscription Status */}
                    <td className="px-4 py-3.5 align-middle">
                      <SubscriptionStatusBadge status={org.subscriptionStatus} />
                    </td>

                    {/* Runway / Period */}
                    <td className="px-4 py-3.5 align-middle">
                      {getRunwayLabel(org)}
                    </td>

                    {/* Staff Seats Meter */}
                    <td className="px-4 py-3.5 text-right align-middle">
                      <div className="flex flex-col items-end">
                        <span
                          className={`font-tabular text-xs ${
                            seatsExceeded ? "font-semibold text-status-attention-fg" : "text-ink"
                          }`}
                        >
                          {org.staffSeats} <span className="text-text-muted font-normal">/ {planLimit.staffSeats}</span>
                        </span>
                        <div className="mt-1 h-1.5 w-20 overflow-hidden rounded-full bg-line/60">
                          <div
                            className={`h-full rounded-full transition-all ${
                              seatsExceeded ? "bg-status-attention-fg" : "bg-ink/70"
                            }`}
                            style={{ width: `${seatsPct}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Orders Meter */}
                    <td className="px-4 py-3.5 text-right align-middle">
                      <div className="flex flex-col items-end">
                        <span
                          className={`font-tabular text-xs ${
                            ordersExceeded ? "font-semibold text-status-attention-fg" : "text-ink"
                          }`}
                        >
                          {org.ordersThisPeriod}{" "}
                          <span className="text-text-muted font-normal">/ {planLimit.ordersPerMonth}</span>
                        </span>
                        <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-line/60">
                          <div
                            className={`h-full rounded-full transition-all ${
                              ordersExceeded ? "bg-status-attention-fg" : "bg-accent/80"
                            }`}
                            style={{ width: `${ordersPct}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* AI Volume Meter */}
                    <td className="px-4 py-3.5 text-right align-middle">
                      <div className="flex flex-col items-end">
                        <span
                          className={`font-tabular text-xs ${
                            aiExceeded ? "font-semibold text-status-attention-fg" : "text-ink"
                          }`}
                        >
                          {org.aiRepliesThisPeriod}{" "}
                          <span className="text-text-muted font-normal">/ {planLimit.aiRepliesPerMonth}</span>
                        </span>
                        <div className="mt-1 h-1.5 w-20 overflow-hidden rounded-full bg-line/60">
                          <div
                            className={`h-full rounded-full transition-all ${
                              aiExceeded ? "bg-status-attention-fg" : "bg-status-progress-fg"
                            }`}
                            style={{ width: `${aiPct}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Actions Column */}
                    <td className="px-4 py-3.5 text-right align-middle sticky right-0 z-10 bg-surface border-l border-line/60">
                      <div className="flex justify-end">
                        <AdminRowActions organizationId={org.id} status={org.subscriptionStatus} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
