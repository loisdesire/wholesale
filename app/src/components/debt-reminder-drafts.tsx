"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
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
    <div className="py-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-ink">{debtor.customerName}</p>
        <span className="font-tabular text-sm font-semibold text-status-attention-fg">
          {formatMoney(debtor.owesCents)}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        {TONES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTone(t.key)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              tone === t.key
                ? "bg-ink text-paper"
                : "border border-line bg-surface text-text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-2 flex items-start gap-2 rounded-xl border border-line bg-paper/60 p-3">
        <p className="flex-1 text-xs text-ink leading-relaxed">{message}</p>
        <button
          type="button"
          onClick={copyMessage}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs font-medium text-text-muted hover:text-ink hover:bg-paper"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
    </div>
  );
}

/** Drafted WhatsApp/Telegram debt-reminder messages for the top outstanding accounts — a starting point to copy, edit, and send by hand, never sent automatically. */
export function DebtReminderDrafts({ debtors }: { debtors: DebtReminderDraft[] }) {
  if (debtors.length === 0) return null;

  return (
    <section className="border-b border-line py-5">
      <div className="pb-1">
        <h2 className="font-display text-base font-semibold text-ink">Debt reminders</h2>
        <p className="text-xs text-text-muted">
          Drafted messages for your top outstanding accounts — pick a tone, copy, and send yourself.
        </p>
      </div>
      <div className="divide-y divide-line/70">
        {debtors.map((d) => (
          <DebtorRow key={d.customerId} debtor={d} />
        ))}
      </div>
    </section>
  );
}
