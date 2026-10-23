-- Partial fulfilment (shipments) and partial refunds.
ALTER TYPE "OrderStatus" ADD VALUE 'PARTIALLY_FULFILLED';
ALTER TYPE "ReturnKind" ADD VALUE 'UNSHIPPED';

-- Goods value vs the amount actually approved for refund (may be lower).
ALTER TABLE "OrderReturn" ADD COLUMN "valueCents" INTEGER;
UPDATE "OrderReturn" SET "valueCents" = "refundCents";
ALTER TABLE "OrderReturn" ALTER COLUMN "valueCents" SET NOT NULL;

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "carrier" TEXT,
    "trackingReference" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentItem" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "ShipmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Shipment_orderId_idx" ON "Shipment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_organizationId_reference_key" ON "Shipment"("organizationId", "reference");

-- CreateIndex
CREATE INDEX "ShipmentItem_shipmentId_idx" ON "ShipmentItem"("shipmentId");

-- CreateIndex
CREATE INDEX "ShipmentItem_orderItemId_idx" ON "ShipmentItem"("orderItemId");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Orders fulfilled before shipments existed shipped everything in one go:
-- record that as a single shipment so "what has shipped" is true for them too
-- (returns are limited to shipped quantities). Uses no new enum values, so it
-- is safe in the same transaction as the ALTER TYPEs above.
INSERT INTO "Shipment" ("id", "organizationId", "orderId", "reference", "notes", "createdAt")
SELECT 'bf_s_' || md5(o."id"), o."organizationId", o."id", o."reference" || '/1',
       'Backfilled: order was fulfilled before shipments were recorded', COALESCE(o."fulfilledAt", o."updatedAt")
  FROM "Order" o
 WHERE o."status" = 'FULFILLED';

INSERT INTO "ShipmentItem" ("id", "shipmentId", "orderItemId", "quantity")
SELECT 'bf_si_' || md5(oi."id"), 'bf_s_' || md5(o."id"), oi."id", oi."quantity"
  FROM "OrderItem" oi
  JOIN "Order" o ON o."id" = oi."orderId"
 WHERE o."status" = 'FULFILLED';
