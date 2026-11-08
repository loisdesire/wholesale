-- Voyage AI multimodal embedding for real image-to-image visual search (see src/lib/ai/voyage.ts).
-- Existing rows and uploads with VOYAGE_API_KEY unset simply have no vector (Prisma reads NULL
-- back as an empty list for scalar list fields) and are skipped by visual search, not backfilled.
ALTER TABLE "ProductImage" ADD COLUMN     "embedding" DOUBLE PRECISION[];
