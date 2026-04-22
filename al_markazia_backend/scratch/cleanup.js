const prisma = require('../src/lib/prisma');
async function main() {
  try {
    await prisma.orderItem.deleteMany();
    await prisma.orderCancellation.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.orderAuditLog.deleteMany();
    await prisma.loyaltyTransaction.deleteMany();
    await prisma.order.deleteMany();
    console.log('🧹 Database cleaned for re-test.');
  } catch (err) {
    console.error('❌ Cleanup failed:', err);
  }
  process.exit(0);
}
main();
