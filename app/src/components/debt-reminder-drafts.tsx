"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { formatMoney } from "@/lib/format";
import type { DebtReminderDraft } from "@/lib/owner-ai";

const TONES = [
  { key: "respectful", label: "Respectful" },
  { key: "firm", label: "Firm" },
  { key: "pidgin", label: "Pidgin" },
] as const;

function DebtorRow({ debtor }: { debtor: DebtReminderDraft }) {
  const [tone, setTone] = useState<(typeof TONES)[number]["key"]>("respectful");
  const [copied, setCopied] = useState(false);
  const message = debtor.tones[tone];

  const copyMessage = () => {
    navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-ink">{debtor.customerName}</p>
        <span className="font-tabular text-sm font-semibold text-status-attention-fg">{formatMoney(debtor.owesCents)}</span>
      </div>
      <div className="chip-row mt-2">
        {TONES.map((t) => (
          <button key={t.key} type="button" onClick={() => setTone(t.key)} className={`chip ${tone === t.key ? "chip-active" : ""}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-start gap-2 rounded-xl bg-paper p-3">
        <p className="flex-1 text-xs leading-relaxed text-ink">{message}</p>
        <button type="button" onClick={copyMessage} className="btn btn-secondary btn-sm shrink-0">
          {copied ? <Check size={13} className="text-status-success-fg" /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/** Drafted reminder messages for the top outstanding accounts — to copy, edit and send by hand, never sent automatically. */
export function DebtReminderDrafts({ debtors }: { debtors: DebtReminderDraft[] }) {
  if (debtors.length === 0) return null;
  return (
    <section>
      <h2 className="section-title">Payment reminders</h2>
      <p className="mb-3 text-xs text-text-muted">Draft messages. Pick a tone, copy, send yourself.</p>
      <div className="card divide-y divide-line overflow-hidden">
        {debtors.map((d) => (
          <DebtorRow key={d.customerId} debtor={d} />
        ))}
      </div>
    </section>
  );
}
