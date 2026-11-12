"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateTime, formatMoney } from "@/lib/format";
import { OrderStatusBadge } from "@/components/status-badge";
import { Avatar } from "@/components/avatar";
import { applyBulkAssignAction, previewBulkAssignAction, type BulkAssignOutcome } from "../operations/actions";

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

/** Order list with row selection and a bulk-assign bar, for owners only (staff get a plain list). */
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
    <div className="flex flex-col gap-3">
      {canBulkAssign && selected.size > 0 && (
        <div className="card flex flex-col gap-3 border-accent/40 bg-accent-soft p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink">{selected.size} selected</span>
            <select
              aria-label="Assign selected orders to"
              value={assigneeId}
              onChange={(e) => {
                setAssigneeId(e.target.value);
                setPreview(null);
              }}
              className="input input-sm"
            >
              <option value="">Unassign</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={runPreview}
              disabled={pending}
              className="btn btn-secondary btn-sm"
            >
              Preview
            </button>
            {preview && (
              <button
                type="button"
                onClick={apply}
                disabled={pending}
                className="btn btn-primary btn-sm"
              >
                {pending ? "Applying…" : `Apply to ${okCount} order${okCount === 1 ? "" : "s"}`}
              </button>
            )}
          </div>
          {preview && (
            <ul className="flex flex-col gap-1 text-xs">
              {preview.map((r) => (
                <li key={r.orderId} className={r.ok ? "text-text-muted" : "text-status-attention-fg"}>
                  {r.reference ?? r.orderId}:{" "}
                  {r.outcome === "assigned"
                    ? "will be assigned"
                    : r.outcome === "unassigned"
                      ? "will be unassigned"
                      : r.outcome === "unchanged"
                        ? "no change needed"
                        : `refused — ${r.reason}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr className="thead-row">
              {canBulkAssign && (
                <th className="w-10 py-2 pr-3">
                  <input type="checkbox" checked={selected.size === orders.length && orders.length > 0} onChange={toggleAll} aria-label="Select all" />
                </th>
              )}
              <th className="py-2 pr-4">Reference</th>
              <th className="py-2 pr-4">Customer</th>
              <th className="py-2 pr-4">Items</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Assigned to</th>
              <th className="py-2 pr-4">Created</th>
              <th className="py-2 pr-4 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="trow">
                {canBulkAssign && (
                  <td className="py-3 pr-3">
                    <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} aria-label={`Select ${o.reference}`} />
                  </td>
                )}
                <td className="py-3 pr-4 font-mono text-[13px] font-medium">
                  <Link href={`/orders/${o.id}`} className="text-ink underline-offset-4 hover:text-accent hover:underline">
                    {o.reference}
                  </Link>
                </td>
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={o.customerName ?? o.customerPhone} size="sm" />
                    <div>
                      <p className="whitespace-nowrap font-medium text-ink">{o.customerName ?? "Unnamed"}</p>
                      <p className="font-tabular text-xs text-text-muted">{o.customerPhone}</p>
                    </div>
                  </div>
                </td>
                <td className="whitespace-nowrap py-3 pr-4 text-text-muted">{o.units} units</td>
                <td className="py-3 pr-4">
                  <OrderStatusBadge status={o.status} />
                </td>
                <td className="whitespace-nowrap py-3 pr-4 text-text-muted">{o.assignedToName ?? "—"}</td>
                <td className="whitespace-nowrap py-3 pr-4 text-xs text-text-muted">{formatDateTime(o.createdAt)}</td>
                <td className="whitespace-nowrap py-3 pr-4 text-right font-tabular font-semibold text-ink">{formatMoney(o.totalCents, o.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
