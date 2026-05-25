DELETE FROM "RefreshToken" WHERE "userId" NOT IN (SELECT uuid FROM "User") AND "userId" NOT IN (SELECT uuid FROM "Customer");
DELETE FROM "SystemAuditLog" WHERE "userId" NOT IN (SELECT uuid FROM "User") AND "userId" NOT IN (SELECT uuid FROM "Customer");
