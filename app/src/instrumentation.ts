/**
 * Runs once when the server starts. In production, refuses to start if tenant
 * isolation isn't actually in force (the database connection is a superuser or
 * BYPASSRLS role, or a tenant table lacks row-level security) — better a failed
 * deploy than a running app that quietly isolates nothing. In development it warns.
 * Set ALLOW_UNENFORCED_ISOLATION=true to override, knowingly.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

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
