"use client";

import { useState } from "react";

/** The customer's private status link, with one-tap copy — the fallback when a message can't be sent automatically. */
export function TrackingLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = new URL(path, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link", url);
    }
  }

  return (
    <div className="card flex flex-col gap-2 p-4 text-sm">
      <p className="font-semibold">Customer status link</p>
      <p className="text-text-muted">Anyone with this link can see this order’s progress. It shows no phone number, address or prices.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} className="btn btn-secondary btn-sm">
          {copied ? "Copied" : "Copy link"}
        </button>
        <a href={path} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
          Preview
        </a>
      </div>
    </div>
  );
}
