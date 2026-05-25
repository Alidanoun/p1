const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  try {
    const res1 = await prisma.$executeRawUnsafe(`DELETE FROM "RefreshToken" WHERE "userId" NOT IN (SELECT uuid FROM "User") AND "userId" NOT IN (SELECT uuid FROM "Customer")`);
    console.log('Deleted orphaned RefreshTokens:', res1);
    
    const res2 = await prisma.$executeRawUnsafe(`DELETE FROM "SystemAuditLog" WHERE "userId" NOT IN (SELECT uuid FROM "User") AND "userId" NOT IN (SELECT uuid FROM "Customer")`);
    console.log('Deleted orphaned SystemAuditLogs:', res2);
  } catch(e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
run();
