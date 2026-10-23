-- Customer identity (normalized phone), addresses, per-customer prices,
-- order notes/delivery address, and cancellation-style refunds.

CREATE TYPE "ReturnKind" AS ENUM ('RETURN', 'CANCELLATION');

-- 1. Customer identity key. Mirrors phoneKeyOf() in src/lib/phone.ts.
ALTER TABLE "Customer"
  ADD COLUMN "email" TEXT,
  ADD COLUMN "phoneKey" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Customer" SET "phoneKey" = (
  CASE
    WHEN d ~ '^0\d{10}$'    THEN '234' || substr(d, 2)
    WHEN d ~ '^[789]\d{9}$' THEN '234' || d
    WHEN d ~ '^2340\d{10}$' THEN '234' || substr(d, 5)
    ELSE d
  END)
FROM (
  SELECT c."id" AS cid,
         CASE WHEN regexp_replace(c."phone", '\D', '', 'g') ~ '^00'
              THEN substr(regexp_replace(c."phone", '\D', '', 'g'), 3)
              ELSE regexp_replace(c."phone", '\D', '', 'g') END AS d
    FROM "Customer" c
) x
WHERE "Customer"."id" = x.cid;

-- Existing customers that are really the same person in different formats must
-- be sorted out by a human (merging is never automatic) — stop with a clear
-- message rather than guess or silently lose one.
DO $$
DECLARE dupes TEXT;
BEGIN
  SELECT string_agg("organizationId" || ': ' || "phoneKey", ', ') INTO dupes FROM (
    SELECT "organizationId", "phoneKey" FROM "Customer"
     GROUP BY "organizationId", "phoneKey" HAVING count(*) > 1
  ) t;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot add the customer identity key: customers sharing a phone number in different formats exist (%). Resolve them first.', dupes;
  END IF;
  IF EXISTS (SELECT 1 FROM "Customer" WHERE "phoneKey" IS NULL OR length("phoneKey") < 8 OR length("phoneKey") > 15) THEN
    RAISE EXCEPTION 'Cannot add the customer identity key: some customers have a phone number that is not a valid number.';
  END IF;
END $$;

ALTER TABLE "Customer" ALTER COLUMN "phoneKey" SET NOT NULL;
DROP INDEX "Customer_organizationId_phone_key";
CREATE UNIQUE INDEX "Customer_organizationId_phoneKey_key" ON "Customer"("organizationId", "phoneKey");
CREATE INDEX "Customer_organizationId_name_idx" ON "Customer"("organizationId", "name");

-- 2. Order notes and delivery address.
ALTER TABLE "Order" ADD COLUMN "notes" TEXT, ADD COLUMN "deliveryAddress" TEXT;

-- 3. Refund kind.
ALTER TABLE "OrderReturn" ADD COLUMN "kind" "ReturnKind" NOT NULL DEFAULT 'RETURN';

-- 4. Addresses and agreed prices.
CREATE TABLE "CustomerAddress" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" TEXT,
    "text" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerPrice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerPrice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerAddress_customerId_idx" ON "CustomerAddress"("customerId");
CREATE UNIQUE INDEX "CustomerPrice_customerId_productId_key" ON "CustomerPrice"("customerId", "productId");

ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerPrice" ADD CONSTRAINT "CustomerPrice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerPrice" ADD CONSTRAINT "CustomerPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
