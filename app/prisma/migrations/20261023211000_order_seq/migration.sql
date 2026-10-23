-- Atomic per-organization order numbering (replaces count-based references,
-- which collided under concurrent draft creation).
ALTER TABLE "Organization" ADD COLUMN "orderSeq" INTEGER NOT NULL DEFAULT 1000;

-- Existing references were issued as ORD-(1000 + n); continue from the highest.
UPDATE "Organization" o
   SET "orderSeq" = GREATEST(1000, COALESCE((
         SELECT MAX(CAST(SUBSTRING(ord."reference" FROM 5) AS INTEGER))
           FROM "Order" ord
          WHERE ord."organizationId" = o."id" AND ord."reference" ~ '^ORD-[0-9]+$'
       ), 1000));
