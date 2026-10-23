-- Splits the single stock number into physical / reserved / damaged figures.
-- (available = physical - reserved - damaged is derived, never stored.)
-- See src/lib/stock-effects.ts for the per-reason rules this backfill mirrors.

ALTER TYPE "StockMovementReason" ADD VALUE 'RETURN_DAMAGED';
ALTER TYPE "StockMovementReason" ADD VALUE 'DAMAGE_WRITTEN_OFF';

ALTER TABLE "StockMovement"
  ADD COLUMN "physicalDelta" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reservedDelta" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "damagedDelta"  INTEGER NOT NULL DEFAULT 0;

-- Backfill from the old single-number ledger (quantityDelta was the change in
-- available stock).
-- A reservation took units out of availability but not off the shelf.
UPDATE "StockMovement"
   SET "reservedDelta" = -"quantityDelta"
 WHERE "reason" IN ('SALE_RESERVED', 'RESERVATION_RELEASED');

-- The old DAMAGE reason meant "written off": units were discarded outright.
-- Keep that meaning under a reason that still exists with the same effect.
UPDATE "StockMovement"
   SET "physicalDelta" = "quantityDelta",
       "reason" = 'MANUAL_ADJUSTMENT',
       "note" = CASE WHEN "note" IS NULL THEN 'Damage write-off (recorded before damaged stock was tracked separately)'
                     ELSE "note" || ' [damage write-off, recorded before damaged stock was tracked separately]' END
 WHERE "reason" = 'DAMAGE';

-- Everything else changed the units physically on hand by the same amount
-- (including any pre-existing SALE_FULFILLED rows, which were direct deductions).
UPDATE "StockMovement"
   SET "physicalDelta" = "quantityDelta"
 WHERE "reason" NOT IN ('SALE_RESERVED', 'RESERVATION_RELEASED', 'MANUAL_ADJUSTMENT')
    OR ("reason" = 'MANUAL_ADJUSTMENT' AND "physicalDelta" = 0);

-- Previously fulfilling an order wrote no movement, so units reserved for
-- already-fulfilled orders would otherwise count as reserved forever. Record
-- the shipment those orders never had (only for lines that did reserve stock).
-- quantityDelta (change in available) is 0: availability already dropped at confirmation.
INSERT INTO "StockMovement" ("id", "organizationId", "productId", "reason", "quantityDelta", "physicalDelta", "reservedDelta", "reference", "note", "createdAt")
SELECT 'bf_' || md5(oi."id"), o."organizationId", oi."productId", 'SALE_FULFILLED', 0, -oi."quantity", -oi."quantity", o."reference",
       'Backfilled shipment for an order fulfilled before shipments were recorded', COALESCE(o."fulfilledAt", o."updatedAt")
  FROM "OrderItem" oi
  JOIN "Order" o ON o."id" = oi."orderId"
 WHERE o."status" = 'FULFILLED'
   AND EXISTS (SELECT 1 FROM "StockMovement" m
                WHERE m."reference" = o."reference" AND m."productId" = oi."productId" AND m."reason" = 'SALE_RESERVED')
   AND NOT EXISTS (SELECT 1 FROM "StockMovement" m
                    WHERE m."reference" = o."reference" AND m."productId" = oi."productId" AND m."reason" = 'SALE_FULFILLED');

ALTER TABLE "StockMovement" DROP COLUMN "quantityDelta";
