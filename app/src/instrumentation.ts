/**
 * Runs once when the server starts. In production, refuses to start if tenant
 * isolation isn't actually in force (the database connection is a superuser or
 * BYPASSRLS role, or a tenant table lacks row-level security) — better a failed
 * deploy than a running app that quietly isolates nothing. In development it warns.
 * Set ALLOW_UNENFORCED_ISOLATION=true to override, knowingly.
 *
 * Also loads Sentry's server config here (Next.js's documented hook for it) — see
 * sentry.server.config.ts for why that's a no-op without SENTRY_DSN set. Only the Node.js
 * runtime is covered; this app has no edge middleware logic worth instrumenting separately
 * today (see docs/MONITORING_AND_BACKUPS.md).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  await import("../sentry.server.config");

  const { checkTenantIsolation } = await import("@/lib/isolation-check");
  let status;
  try {
    status = await checkTenantIsolation();
  } catch (err) {
    console.warn("Could not verify tenant isolation at startup:", err instanceof Error ? err.message : err);
    return;
  }
  if (status.enforced) return;

  const message = `Tenant isolation is NOT enforced (${status.problems.join("; ")}). See docs/ISOLATION.md.`;
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_UNENFORCED_ISOLATION !== "true") {
    throw new Error(message);
  }
  console.warn(`⚠ ${message}`);
}

// Captures errors from Server Components, route handlers and server actions that Next.js
// itself catches — a safe no-op when Sentry was never initialized (no SENTRY_DSN).
export { captureRequestError as onRequestError } from "@sentry/nextjs";
