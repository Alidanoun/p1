-- ==========================================
-- PHASE 1: SAFE SCHEMA MIGRATION
-- ==========================================

-- 1. Add temporary new columns to hold numeric IDs
ALTER TABLE "RefreshToken" ADD COLUMN "userId_new" INTEGER;
ALTER TABLE "RefreshToken" ADD COLUMN "customerId_new" INTEGER;

ALTER TABLE "SystemAuditLog" ADD COLUMN "userId_new" INTEGER;
ALTER TABLE "SystemAuditLog" ADD COLUMN "customerId_new" INTEGER;

-- 2. Migrate existing UUID data to the new columns by joining with User/Customer tables
UPDATE "RefreshToken" rt
SET "userId_new" = u.id
FROM "User" u
WHERE rt."userId" = u.uuid;

UPDATE "RefreshToken" rt
SET "customerId_new" = c.id
FROM "Customer" c
WHERE rt."userId" = c.uuid;

UPDATE "SystemAuditLog" sal
SET "userId_new" = u.id
FROM "User" u
WHERE sal."userId" = u.uuid;

UPDATE "SystemAuditLog" sal
SET "customerId_new" = c.id
FROM "Customer" c
WHERE sal."userId" = c.uuid;

-- 3. PROGRAMMATIC ROLLBACK GUARD (Enforces data integrity before destructive schema changes)
DO $$
BEGIN
  -- Check for orphaned RefreshToken entries (that won't match any User or Customer ID)
  IF EXISTS (
    SELECT 1 FROM "RefreshToken"
    WHERE "userId" IS NOT NULL
      AND "userId_new" IS NULL
      AND "customerId_new" IS NULL
  ) THEN
    RAISE EXCEPTION 'Migration aborted: Orphaned UUIDs found in RefreshToken table. Perform cleanup first.';
  END IF;

  -- Check for orphaned SystemAuditLog entries
  IF EXISTS (
    SELECT 1 FROM "SystemAuditLog"
    WHERE "userId" IS NOT NULL
      AND "userId_new" IS NULL
      AND "customerId_new" IS NULL
  ) THEN
    RAISE EXCEPTION 'Migration aborted: Orphaned UUIDs found in SystemAuditLog table. Perform cleanup first.';
  END IF;
END $$;

-- 4. Drop original polymorphic columns and rename the migrated columns
ALTER TABLE "RefreshToken" DROP COLUMN "userId";
ALTER TABLE "RefreshToken" RENAME COLUMN "userId_new" TO "userId";
ALTER TABLE "RefreshToken" RENAME COLUMN "customerId_new" TO "customerId";

ALTER TABLE "SystemAuditLog" DROP COLUMN "userId";
ALTER TABLE "SystemAuditLog" RENAME COLUMN "userId_new" TO "userId";
ALTER TABLE "SystemAuditLog" RENAME COLUMN "customerId_new" TO "customerId";

-- 5. Establish Foreign Keys constraints
ALTER TABLE "RefreshToken"
  ADD CONSTRAINT "RefreshToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE;

ALTER TABLE "RefreshToken"
  ADD CONSTRAINT "RefreshToken_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"(id) ON DELETE CASCADE;

ALTER TABLE "SystemAuditLog"
  ADD CONSTRAINT "SystemAuditLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE SET NULL;

ALTER TABLE "SystemAuditLog"
  ADD CONSTRAINT "SystemAuditLog_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"(id) ON DELETE SET NULL;

-- 6. PERFORMANCE TUNING: Explicit FK Indexes
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");
CREATE INDEX "RefreshToken_customerId_idx" ON "RefreshToken"("customerId");

CREATE INDEX "SystemAuditLog_userId_idx" ON "SystemAuditLog"("userId");
CREATE INDEX "SystemAuditLog_customerId_idx" ON "SystemAuditLog"("customerId");
