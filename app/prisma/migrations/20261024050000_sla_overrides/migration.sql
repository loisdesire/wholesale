-- Per-organization SLA overrides (src/lib/ops-config.ts's hardcoded defaults become
-- per-org-overridable). Organization is identity/registry data, not a tenant table —
-- no RLS change needed here.
ALTER TABLE "Organization" ADD COLUMN "slaOverrides" JSONB;
