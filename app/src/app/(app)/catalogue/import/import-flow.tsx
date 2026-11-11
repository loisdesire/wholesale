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
import { 
  FileUp, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  ArrowRight,
  Upload
} from "lucide-react";

const initialPreview: ImportPreviewState = { error: null };
const initialCommit: ImportCommitState = { error: null };

function ActionLabel({ action }: { action: "create" | "update" | "error" }) {
  const classes =
    action === "error"
      ? "text-status-attention-fg bg-status-attention-bg"
      : action === "create"
        ? "text-status-success-fg bg-status-success-bg"
        : "text-status-progress-fg bg-status-progress-bg";
  const label = action === "error" ? "Error" : action === "create" ? "New SKU" : "Update";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${classes}`}>
      {label}
    </span>
  );
}

export function ImportFlow() {
  const [preview, previewAction, previewPending] = useActionState(previewImportAction, initialPreview);
  const [commit, commitActionFn, commitPending] = useActionState(commitImportAction, initialCommit);

  if (commit.created !== undefined) {
    return (
      <div className="card-base p-8 text-center flex flex-col items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-status-success-bg text-status-success-fg">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <h2 className="font-display text-xl font-semibold text-ink">Catalogue Import Complete</h2>
        <p className="text-sm text-text-muted">
          Successfully created <strong className="text-ink">{commit.created}</strong> new product{commit.created === 1 ? "" : "s"} and updated <strong className="text-ink">{commit.updated}</strong> existing product{commit.updated === 1 ? "" : "s"}.
        </p>
        <Link 
          href="/catalogue" 
          className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition-all hover:bg-ink/90"
        >
          <span>Return to Catalogue</span>
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  if (!preview.rows) {
    return (
      <form action={previewAction} className="card-base p-6 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <label htmlFor="file" className="text-xs font-semibold text-ink">
            Select CSV Spreadsheet
          </label>
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-line bg-paper/20 p-8 text-center hover:bg-paper/40 transition-colors">
            <Upload className="h-8 w-8 text-text-muted mb-2" />
            <p className="text-sm font-medium text-ink">Upload your product inventory CSV</p>
            <p className="text-xs text-text-muted mt-1 max-w-md">
              Accepted columns: <code className="font-mono text-xs text-ink">sku, name, price, colour, size, moq, unit, opening_stock</code>
            </p>
            <input
              id="file"
              name="file"
              type="file"
              accept=".csv,text/csv"
              required
              className="mt-4 text-xs text-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-ink cursor-pointer"
            />
          </div>
        </div>

        {preview.error && (
          <div className="flex items-center gap-2 rounded-md border border-status-attention-fg/30 bg-status-attention-bg p-3 text-xs text-status-attention-fg">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{preview.error}</span>
          </div>
        )}

        <div className="flex justify-end border-t border-line pt-4">
          <button
            type="submit"
            disabled={previewPending}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-paper transition-all hover:bg-accent-2 disabled:opacity-60"
          >
            {previewPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileUp className="h-4 w-4" />
            )}
            <span>{previewPending ? "Parsing CSV…" : "Preview Import"}</span>
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
      {/* Metrics Banner */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card-base p-3.5 text-center">
          <span className="text-xs uppercase font-semibold text-ink/80">New Products</span>
          <p className="font-display text-xl font-bold text-status-success-fg mt-0.5">{createCount}</p>
        </div>
        <div className="card-base p-3.5 text-center">
          <span className="text-xs uppercase font-semibold text-ink/80">Updates</span>
          <p className="font-display text-xl font-bold text-status-progress-fg mt-0.5">{updateCount}</p>
        </div>
        <div className="card-base p-3.5 text-center">
          <span className="text-xs uppercase font-semibold text-ink/80">Errors / Skipped</span>
          <p className={`font-display text-xl font-bold mt-0.5 ${errorCount > 0 ? "text-status-attention-fg" : "text-text-muted"}`}>
            {errorCount}
          </p>
        </div>
      </div>

      {/* Preview Table */}
      <div className="card-base overflow-hidden">
        <div className="max-h-[460px] overflow-y-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-paper/80 backdrop-blur-xs border-b border-line text-left text-xs text-text-muted">
              <tr>
                <th className="px-4 py-3 w-16">Row</th>
                <th className="px-4 py-3 w-36">SKU</th>
                <th className="px-4 py-3 w-28">Action</th>
                <th className="px-4 py-3">Product Name</th>
                <th className="px-4 py-3 text-right w-32">Price</th>
                <th className="px-4 py-3">Validation Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {preview.rows.map((row) => (
                <tr key={row.rowNumber} className="hover:bg-paper/20">
                  <td className="px-4 py-3 font-tabular text-text-muted text-xs">{row.rowNumber}</td>
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-ink">{row.sku}</td>
                  <td className="px-4 py-3">
                    <ActionLabel action={row.action} />
                  </td>
                  <td className="px-4 py-3 text-ink font-medium">{row.name ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-tabular text-ink">
                    {row.priceCents !== undefined ? formatMoney(row.priceCents) : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-status-attention-fg">
                    {row.errors.join("; ") || <span className="text-status-success-fg">Valid</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Commit Bar */}
      <form action={commitActionFn} className="card-base p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
        <input type="hidden" name="csvText" value={preview.csvText} />
        {commit.error && (
          <p className="text-xs text-status-attention-fg font-medium">{commit.error}</p>
        )}

        <div className="flex items-center gap-3 ml-auto">
          <Link 
            href="/catalogue" 
            className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-text-muted hover:text-ink hover:bg-paper transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={commitPending || !canCommit}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-paper transition-all hover:bg-accent-2 disabled:opacity-60"
          >
            {commitPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            <span>{commitPending ? "Importing Products…" : `Commit Import (${createCount + updateCount} items)`}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
