"use client";

import { useEffect, useState } from "react";
import { markAllNotificationsReadAction, markNotificationsReadAction } from "../operations/actions";

export function MarkAllReadButton() {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await markAllNotificationsReadAction();
        setPending(false);
      }}
      className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-paper disabled:opacity-60"
    >
      Mark all as read
    </button>
  );
}

/**
 * Marks the notices that were unread when the page loaded as read, once, after a
 * short pause — so a quick bounce-off doesn't clear the badge for notices the
 * person didn't actually see.
 *
 * Keyed on the joined id list (a stable string), not a "have we fired yet" ref:
 * a ref guard set synchronously inside the effect survives React's dev-mode
 * mount→cleanup→remount double-invoke, so the remount's effect would see it
 * already set and skip scheduling — the timer the cleanup just cancelled would
 * never be replaced, and the action would silently never run. Keying on `key`
 * instead lets the normal effect/cleanup pair do its job: the first (discarded)
 * timer is cancelled and the second (surviving) one fires normally.
 */
export function MarkReadOnView({ ids }: { ids: string[] }) {
  const key = ids.join(",");
  useEffect(() => {
    if (!key) return;
    const timer = setTimeout(() => {
      markNotificationsReadAction(key.split(","));
    }, 1500);
    return () => clearTimeout(timer);
  }, [key]);
  return null;
}
