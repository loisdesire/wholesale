-- CreateTable
CREATE TABLE "ReportView" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportView_organizationId_idx" ON "ReportView"("organizationId");

-- AddForeignKey
ALTER TABLE "ReportView" ADD CONSTRAINT "ReportView_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportView" ADD CONSTRAINT "ReportView_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Holds tenant data (a saved filter, shared across the organization) — same row-level
-- security as every other tenant table.
ALTER TABLE "ReportView" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportView" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ReportView"
  USING ("organizationId" = current_setting('app.organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.organization_id', true));
