"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  previewImportAction,
  commitImportAction,
  type ImportPreviewState,
  type ImportCommitState,
} from "../actions";
import { formatMoney } from "@/lib/format";

const initialPreview: ImportPreviewState = { error: null };
const initialCommit: ImportCommitState = { error: null };

function ActionLabel({ action }: { action: "create" | "update" | "error" }) {
  const classes =
    action === "error"
      ? "text-status-attention-fg bg-status-attention-bg"
      : action === "create"
        ? "text-status-success-fg bg-status-success-bg"
        : "text-status-progress-fg bg-status-progress-bg";
  const label = action === "error" ? "Error" : action === "create" ? "New" : "Update";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${classes}`}>
      {label}
    </span>
  );
}

export function ImportFlow() {
  const [preview, previewAction, previewPending] = useActionState(previewImportAction, initialPreview);
  const [commit, commitActionFn, commitPending] = useActionState(commitImportAction, initialCommit);

  if (commit.created !== undefined) {
    return (
      <div className="rounded-md border border-line bg-surface p-6 text-sm">
        <p className="text-ink">
          Import complete: {commit.created} product{commit.created === 1 ? "" : "s"} created,{" "}
          {commit.updated} updated.
        </p>
        <Link href="/catalogue" className="mt-3 inline-block text-ink underline underline-offset-2">
          Back to catalogue
        </Link>
      </div>
    );
  }

  if (!preview.rows) {
    return (
      <form action={previewAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="file" className="text-sm font-medium text-ink">
            CSV file
          </label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="text-sm text-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink"
          />
          <p className="text-xs text-text-muted">
            Columns: sku, name, colour, size, other_attributes (JSON), price, cost, moq, unit,
            active, opening_stock. Only sku, name, and price are required.
          </p>
        </div>

        {preview.error && (
          <p role="alert" className="text-sm text-status-attention-fg">
            {preview.error}
          </p>
        )}

        <div>
          <button
            type="submit"
            disabled={previewPending}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-ink-2 disabled:opacity-60"
          >
            {previewPending ? "Reading…" : "Preview import"}
          </button>
        </div>
      </form>
    );
  }

  const errorCount = preview.rows.filter((r) => r.action === "error").length;
  const createCount = preview.rows.filter((r) => r.action === "create").length;
  const updateCount = preview.rows.filter((r) => r.action === "update").length;
  const canCommit = createCount + updateCount > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4 text-sm text-text-muted">
        <span>{createCount} new</span>
        <span>{updateCount} updated</span>
        {errorCount > 0 && <span className="text-status-attention-fg">{errorCount} will be skipped</span>}
      </div>

      <div className="max-h-[480px] overflow-y-auto rounded-md border border-line bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-line text-left text-xs font-medium text-text-muted">
              <th className="px-4 py-2">Row</th>
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2">Action</th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2 text-right">Price</th>
              <th className="px-4 py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => (
              <tr key={row.rowNumber} className="border-b border-line last:border-0">
                <td className="px-4 py-2 font-tabular text-text-muted">{row.rowNumber}</td>
                <td className="px-4 py-2 font-tabular text-ink">{row.sku}</td>
                <td className="px-4 py-2">
                  <ActionLabel action={row.action} />
                </td>
                <td className="px-4 py-2 text-ink">{row.name ?? "—"}</td>
                <td className="px-4 py-2 text-right font-tabular text-ink">
                  {row.priceCents !== undefined ? formatMoney(row.priceCents) : "—"}
                </td>
                <td className="px-4 py-2 text-status-attention-fg">{row.errors.join("; ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form action={commitActionFn} className="flex items-center gap-4">
        <input type="hidden" name="csvText" value={preview.csvText} />
        {commit.error && <p className="text-sm text-status-attention-fg">{commit.error}</p>}
        <button
          type="submit"
          disabled={commitPending || !canCommit}
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-ink-2 disabled:opacity-60"
        >
          {commitPending ? "Importing…" : `Commit import (${createCount + updateCount})`}
        </button>
        <Link href="/catalogue" className="text-sm text-text-muted hover:text-ink">
          Cancel
        </Link>
      </form>
    </div>
  );
}
