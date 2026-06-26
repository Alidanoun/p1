-- AlterTable
ALTER TABLE "Branch" ALTER COLUMN "timezone" SET DEFAULT 'Asia/Amman';

-- AlterTable
ALTER TABLE "Customer" ALTER COLUMN "timezone" SET DEFAULT 'Asia/Amman';

-- AlterTable
ALTER TABLE "HappyHour" ALTER COLUMN "timezone" SET DEFAULT 'Asia/Amman';

-- Correct existing Cairo timezone entries to Amman
UPDATE "Branch" SET timezone = 'Asia/Amman' WHERE timezone = 'Africa/Cairo';
UPDATE "Customer" SET timezone = 'Asia/Amman' WHERE timezone = 'Africa/Cairo';
UPDATE "HappyHour" SET timezone = 'Asia/Amman' WHERE timezone = 'Africa/Cairo';
