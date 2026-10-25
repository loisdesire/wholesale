-- Product photos, stored as bytes directly in Postgres — same approach as MessageAttachment.
-- A child of Product with no organizationId of its own, same pattern as PriceTier.
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductImage_productId_idx" ON "ProductImage"("productId");

ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Same child-table RLS pattern as PriceTier/MessageAttachment (see docs/ISOLATION.md "Adding a
-- table"): visible only if the parent Product is.
ALTER TABLE "ProductImage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductImage" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProductImage"
  USING (EXISTS (SELECT 1 FROM "Product" p WHERE p."id" = "ProductImage"."productId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Product" p WHERE p."id" = "ProductImage"."productId"));
