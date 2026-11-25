// The mark: a chat bubble whose content is a tick — a message that became a done thing.
export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <path
        d="M6 3h20a5 5 0 0 1 5 5v12a5 5 0 0 1-5 5H15l-6.6 5.2A.9.9 0 0 1 7 29.5V25H6a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5Z"
        fill="var(--accent)"
      />
      <path d="m9.5 14.5 4.2 4.2 8.8-9.2" stroke="var(--gold)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ tone = "dark" }: { tone?: "dark" | "light" }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark />
      <span className={`font-display text-[19px] font-bold tracking-tight ${tone === "light" ? "text-white" : "text-ink"}`}>
        Adaeze <span className={tone === "light" ? "text-white/55" : "text-text-muted"}>Wholesale</span>
      </span>
    </span>
  );
}
