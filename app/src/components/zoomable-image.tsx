"use client";

import { useEffect, useState } from "react";

/**
 * A thumbnail that opens a full-screen overlay on click, since src/app/api/attachments/[id]
 * serves the original size — there's no separate thumbnail to link to, so the overlay reuses
 * the same URL at full size instead of a cropped inline view.
 */
export function ZoomableImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="cursor-zoom-in" aria-label={`${alt} — click to view full size`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- tenant-private, authenticated route, not a static asset Next's image optimizer can handle */}
        <img src={src} alt={alt} className={className} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-ink/90 p-6"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
          <img src={src} alt={alt} className="max-h-full max-w-full rounded-md object-contain" />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="absolute right-5 top-5 rounded-md bg-white/10 px-3 py-1.5 text-sm text-paper hover:bg-white/20"
          >
            Close
          </button>
        </div>
      )}
    </>
  );
}
