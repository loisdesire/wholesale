-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "mergedAt" TIMESTAMP(3),
ADD COLUMN     "mergedIntoId" TEXT;

-- CreateTable
CREATE TABLE "CustomerMerge" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "performedById" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "snapshot" JSONB NOT NULL,
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,

    CONSTRAINT "CustomerMerge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerMerge_organizationId_targetId_idx" ON "CustomerMerge"("organizationId", "targetId");

-- CreateIndex
CREATE INDEX "CustomerMerge_sourceId_idx" ON "CustomerMerge"("sourceId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMerge" ADD CONSTRAINT "CustomerMerge_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMerge" ADD CONSTRAINT "CustomerMerge_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

