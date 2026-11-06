"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateTime, formatMoney } from "@/lib/format";
import { OrderStatusBadge } from "@/components/status-badge";
import { applyBulkAssignAction, previewBulkAssignAction, type BulkAssignOutcome } from "../operations/actions";
import { ArrowUpRight, Loader2, Inbox, ChevronRight } from "lucide-react";

export type OrderRow = {
  id: string;
  reference: string;
  customerName: string | null;
  customerPhone: string;
  units: number;
  status: string;
  createdAt: Date;
  totalCents: number;
  currency: string;
  assignedToName: string | null;
};

/** Order list with responsive mobile card stack and desktop ledger table. */
export function OrdersTable({
  orders,
  members,
  canBulkAssign,
}: {
  orders: OrderRow[];
  members: { id: string; name: string }[];
  canBulkAssign: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assigneeId, setAssigneeId] = useState("");
  const [preview, setPreview] = useState<BulkAssignOutcome | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const okCount = preview?.filter((r) => r.ok).length ?? 0;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setPreview(null);
  };
  const toggleAll = () => {
    setSelected((prev) => (prev.size === orders.length ? new Set() : new Set(orders.map((o) => o.id))));
    setPreview(null);
  };

  const runPreview = () =>
    startTransition(async () => {
      setPreview(await previewBulkAssignAction([...selected], assigneeId || null));
    });
  const apply = () =>
    startTransition(async () => {
      await applyBulkAssignAction([...selected], assigneeId || null);
      setSelected(new Set());
      setPreview(null);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4">
      {/* Bulk Action Bar if items selected */}
      {canBulkAssign && selected.size > 0 && (
        <div className="card-base flex flex-col gap-3 rounded-2xl bg-ink p-4 text-paper shadow-xl border border-white/10 animate-in fade-in">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm">
            <div className="flex items-center gap-2.5">
              <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-2 text-xs font-bold text-white shadow-xs">
                {selected.size}
              </span>
              <span className="font-semibold text-paper">orders selected</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-paper/60">Assign to:</span>
                <select
                  aria-label="Assign selected orders to"
                  value={assigneeId}
                  onChange={(e) => {
                    setAssigneeId(e.target.value);
                    setPreview(null);
                  }}
                  className="rounded-xl border border-white/20 bg-white/10 px-3 py-1.5 text-xs text-white outline-none focus:border-accent"
                >
                  <option value="" className="text-ink">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id} className="text-ink">
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={runPreview}
                disabled={pending}
                className="rounded-xl border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20 transition-colors disabled:opacity-60 cursor-pointer"
              >
                Preview
              </button>

              {preview && (
                <button
                  type="button"
                  onClick={apply}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-accent-2 transition-colors disabled:opacity-60 cursor-pointer"
                >
                  {pending ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Applying…</span>
                    </>
                  ) : (
                    <span>Confirm ({okCount})</span>
                  )}
                </button>
              )}
            </div>
          </div>

          {preview && (
            <div className="border-t border-white/10 pt-2 text-xs">
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {preview.map((r) => (
                  <li key={r.orderId} className={r.ok ? "text-paper/70 font-tabular" : "text-rose-300 font-semibold"}>
                    {r.reference ?? r.orderId}: {r.outcome}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Main Order View */}
      {orders.length === 0 ? (
        <div className="card-base flex flex-col items-center justify-center rounded-2xl p-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-paper text-text-muted">
            <Inbox className="h-6 w-6" />
          </div>
          <h2 className="mt-3 font-display text-base font-semibold text-ink">No matching orders found</h2>
          <p className="mt-1 text-xs text-text-muted">
            Try adjusting your search query, status filters, or date range.
          </p>
        </div>
      ) : (
        <>
          {/* Mobile Card Stack (sm:hidden) */}
          <div className="flex flex-col gap-3 sm:hidden">
            {orders.map((o) => (
              <div
                key={o.id}
                className="card-base rounded-2xl p-4 shadow-xs hover:border-line transition-all active:scale-[0.99]"
              >
                <div className="flex items-center justify-between gap-2 border-b border-line/60 pb-2.5">
                  <div className="flex items-center gap-2">
                    {canBulkAssign && (
                      <input
                        type="checkbox"
                        checked={selected.has(o.id)}
                        onChange={() => toggle(o.id)}
                        aria-label={`Select ${o.reference}`}
                        className="h-4 w-4 rounded-md border-line text-accent focus:ring-accent"
                      />
                    )}
                    <Link
                      href={`/orders/${o.id}`}
                      className="inline-flex items-center rounded-md bg-paper/80 px-2 py-0.5 font-mono text-xs font-bold text-ink"
                    >
                      {o.reference}
                    </Link>
                  </div>
                  <OrderStatusBadge status={o.status} />
                </div>

                <Link href={`/orders/${o.id}`} className="block py-2.5 space-y-1">
                  <p className="font-semibold text-sm text-ink">{o.customerName ?? "Unnamed Customer"}</p>
                  <p className="font-tabular text-xs text-text-muted">{o.customerPhone}</p>
                </Link>

                <div className="flex items-center justify-between border-t border-line/60 pt-2.5 text-xs">
                  <div className="flex items-center gap-2 text-text-muted">
                    <span className="font-tabular font-medium">{o.units} {o.units === 1 ? "unit" : "units"}</span>
                    <span>·</span>
                    <span className="font-tabular">{formatDateTime(o.createdAt)}</span>
                  </div>

                  <Link
                    href={`/orders/${o.id}`}
                    className="inline-flex items-center gap-1 font-tabular text-sm font-bold text-ink"
                  >
                    <span>{formatMoney(o.totalCents, o.currency)}</span>
                    <ChevronRight className="h-4 w-4 text-text-muted" />
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table View (hidden sm:block) */}
          <div className="card-base overflow-hidden rounded-2xl hidden sm:block">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line bg-paper/60 text-xs font-semibold uppercase tracking-wider text-ink/80">
                    {canBulkAssign && (
                      <th className="w-10 py-3.5 pl-5 pr-2">
                        <input
                          type="checkbox"
                          checked={selected.size === orders.length && orders.length > 0}
                          onChange={toggleAll}
                          aria-label="Select all"
                          className="h-4 w-4 rounded-md border-line text-accent focus:ring-accent"
                        />
                      </th>
                    )}
                    <th className={`py-3.5 pr-4 ${!canBulkAssign ? "pl-5" : ""}`}>Order</th>
                    <th className="py-3.5 pr-4">Customer</th>
                    <th className="py-3.5 pr-4">Items</th>
                    <th className="py-3.5 pr-4">Status</th>
                    <th className="py-3.5 pr-4">Assigned</th>
                    <th className="py-3.5 pr-4">Date</th>
                    <th className="py-3.5 pl-4 pr-5 text-right">Settlement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {orders.map((o) => (
                    <tr
                      key={o.id}
                      className="group transition-colors hover:bg-paper/40 cursor-pointer"
                    >
                      {canBulkAssign && (
                        <td className="py-3.5 pl-5 pr-2">
                          <input
                            type="checkbox"
                            checked={selected.has(o.id)}
                            onChange={() => toggle(o.id)}
                            aria-label={`Select ${o.reference}`}
                            className="h-4 w-4 rounded-md border-line text-accent focus:ring-accent"
                          />
                        </td>
                      )}

                      {/* Order Reference */}
                      <td className={`py-3.5 pr-4 ${!canBulkAssign ? "pl-5" : ""}`}>
                        <Link
                          href={`/orders/${o.id}`}
                          className="inline-flex items-center rounded-md bg-paper/80 px-2 py-1 font-mono text-xs font-bold text-ink group-hover:bg-accent/10 group-hover:text-accent transition-colors"
                        >
                          {o.reference}
                        </Link>
                      </td>

                      {/* Customer */}
                      <td className="py-3.5 pr-4">
                        <Link href={`/orders/${o.id}`} className="block">
                          <p className="font-semibold text-ink group-hover:text-accent transition-colors">
                            {o.customerName ?? "Unnamed Customer"}
                          </p>
                          <p className="font-tabular text-xs text-text-muted">{o.customerPhone}</p>
                        </Link>
                      </td>

                      {/* Units */}
                      <td className="py-3.5 pr-4 font-tabular text-xs font-medium text-text-muted">
                        {o.units} {o.units === 1 ? "unit" : "units"}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 pr-4">
                        <OrderStatusBadge status={o.status} />
                      </td>

                      {/* Assigned */}
                      <td className="py-3.5 pr-4 text-xs font-medium">
                        {o.assignedToName ? (
                          <span className="inline-flex items-center gap-1.5 text-ink">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            <span>{o.assignedToName}</span>
                          </span>
                        ) : (
                          <span className="text-text-muted/60 italic">Unassigned</span>
                        )}
                      </td>

                      {/* Date */}
                      <td className="py-3.5 pr-4 font-tabular text-xs text-text-muted">
                        {formatDateTime(o.createdAt)}
                      </td>

                      {/* Total Amount */}
                      <td className="py-3.5 pl-4 pr-5 text-right">
                        <Link
                          href={`/orders/${o.id}`}
                          className="inline-flex items-center gap-1 font-tabular text-sm font-bold text-ink group-hover:text-accent transition-colors"
                        >
                          <span>{formatMoney(o.totalCents, o.currency)}</span>
                          <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100 text-accent" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
