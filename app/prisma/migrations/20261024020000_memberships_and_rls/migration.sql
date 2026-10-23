-- Tenant isolation: memberships (a user can belong to several organizations, with a
-- role in each) and Postgres row-level security on every tenant-owned table.

-- 1. Memberships, populated from the old single-organization users before those
--    columns are dropped.
ALTER TABLE "Organization" ADD COLUMN "whatsappPhoneNumberId" TEXT;
CREATE UNIQUE INDEX "Organization_whatsappPhoneNumberId_key" ON "Organization"("whatsappPhoneNumberId");

CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'STAFF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Membership_organizationId_idx" ON "Membership"("organizationId");
CREATE UNIQUE INDEX "Membership_userId_organizationId_key" ON "Membership"("userId", "organizationId");
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Membership" ("id", "userId", "organizationId", "role", "createdAt")
SELECT 'mem_' || md5(u."id"), u."id", u."organizationId", u."role", u."createdAt" FROM "User" u;

ALTER TABLE "User" DROP CONSTRAINT "User_organizationId_fkey";
ALTER TABLE "User" DROP COLUMN "organizationId", DROP COLUMN "role";

-- 2. The restricted role the application should connect as. A superuser (or any
--    role with BYPASSRLS) silently ignores row-level security, so the app must not
--    use one. The role is created without a login; whoever deploys sets a password
--    (docker-compose does this for local development) — see docs/ISOLATION.md.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wholesale_app') THEN
    CREATE ROLE wholesale_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not create role wholesale_app (insufficient privilege) — create it yourself; see docs/ISOLATION.md';
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wholesale_app') THEN
    GRANT USAGE ON SCHEMA public TO wholesale_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wholesale_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wholesale_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wholesale_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO wholesale_app;
  END IF;
END $$;

-- 3. Row-level security. Every query runs inside a transaction that first sets
--    app.organization_id; a row is visible and writable only when its organizationId
--    matches. With no setting, current_setting(..., true) is NULL, nothing matches,
--    and the query sees no rows — it fails closed. FORCE applies the policy to the
--    table owner too (superusers are the one thing that still bypasses it).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Product', 'StockMovement', 'Customer', 'Conversation', 'Order', 'AuditLog',
    'OrderReturn', 'Shipment', 'CustomerAddress', 'CustomerPrice', 'CustomerMerge'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.organization_id'', true)) WITH CHECK ("organizationId" = current_setting(''app.organization_id'', true))',
      t
    );
  END LOOP;
END $$;

-- Child tables have no organizationId of their own: they are visible only if their
-- parent is (the sub-select is itself subject to the parent's policy).
ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Message" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Message"
  USING (EXISTS (SELECT 1 FROM "Conversation" p WHERE p."id" = "Message"."conversationId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Conversation" p WHERE p."id" = "Message"."conversationId"));

ALTER TABLE "OrderItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OrderItem"
  USING (EXISTS (SELECT 1 FROM "Order" p WHERE p."id" = "OrderItem"."orderId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Order" p WHERE p."id" = "OrderItem"."orderId"));

ALTER TABLE "PriceTier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PriceTier" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PriceTier"
  USING (EXISTS (SELECT 1 FROM "Product" p WHERE p."id" = "PriceTier"."productId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Product" p WHERE p."id" = "PriceTier"."productId"));

ALTER TABLE "ReturnItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReturnItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ReturnItem"
  USING (EXISTS (SELECT 1 FROM "OrderReturn" p WHERE p."id" = "ReturnItem"."returnId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "OrderReturn" p WHERE p."id" = "ReturnItem"."returnId"));

ALTER TABLE "ShipmentItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShipmentItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ShipmentItem"
  USING (EXISTS (SELECT 1 FROM "Shipment" p WHERE p."id" = "ShipmentItem"."shipmentId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Shipment" p WHERE p."id" = "ShipmentItem"."shipmentId"));

-- User, Membership and Organization are the identity/tenant registry (login has to
-- read them before any tenant is known) and carry no tenant data, so they have no
-- policy; application code reaches them only through the root client.
