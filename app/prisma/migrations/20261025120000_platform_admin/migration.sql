-- Platform operator flag — not a tenant role. User is identity data (see docs/ISOLATION.md),
-- not subject to RLS; isPlatformAdmin is read-only gated in the app, never a bypass of RLS
-- itself (the /admin overview still reaches each organization's tenant data through the normal
-- tenantDb() path, one organization at a time, same as everywhere else in this app).
ALTER TABLE "User" ADD COLUMN "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;
