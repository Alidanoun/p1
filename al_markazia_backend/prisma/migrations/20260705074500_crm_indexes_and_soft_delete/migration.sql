-- CreateExtension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterTable Lead
ALTER TABLE "Lead" ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Lead" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- AlterTable Opportunity
ALTER TABLE "Opportunity" ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Opportunity" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateIndex: Lead Composite Index for filtering
CREATE INDEX "idx_lead_branch_status_assigned" ON "Lead"("branchId", "status", "assignedToId", "createdAt" DESC);
CREATE INDEX "Lead_branchId_isDeleted_status_idx" ON "Lead"("branchId", "isDeleted", "status");

-- CreateIndex: Opportunity Composite Index for filtering
CREATE INDEX "idx_opportunity_branch_stage" ON "Opportunity"("branchId", "stage", "assignedToId", "updatedAt" DESC);

-- CreateIndex: SalesActivity Timeline Indexes
CREATE INDEX "idx_activity_lead" ON "SalesActivity"("leadId", "activityDate" DESC);
CREATE INDEX "idx_activity_customer" ON "SalesActivity"("customerId", "activityDate" DESC);

-- CreateIndex: Lead pg_trgm index for fast ILIKE searches
CREATE INDEX "idx_lead_name_trgm" ON "Lead" USING gin ("name" gin_trgm_ops);
