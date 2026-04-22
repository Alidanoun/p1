const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function findRecentCancellers() {
  const window = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours
  const cancellations = await prisma.orderCancellation.findMany({
    where: { createdAt: { gte: window } },
    include: { order: true }
  });
  
  console.log('--- Customers with cancellations in last 2 hours ---');
  const uniquePhones = [...new Set(cancellations.map(c => c.order.customerPhone))];
  
  for (const phone of uniquePhones) {
    const customer = await prisma.customer.findUnique({ where: { phone } });
    console.log(`Phone: ${phone}, Name: ${customer?.name}, isBlacklisted: ${customer?.isBlacklisted}, Cancels: ${cancellations.filter(c => c.order.customerPhone === phone).length}`);
    
    // Auto-fix for the user
    if (!customer.isBlacklisted) {
      await prisma.customer.update({
        where: { phone },
        data: {
          isBlacklisted: true,
          blacklistedAt: new Date(),
          blacklistReason: 'Spam Auto-Detect (Retroactive Fix)',
          blacklistType: 'auto',
          blacklistUntil: new Date(Date.now() + 10 * 60 * 1000) // 10 mins
        }
      });
      console.log(`>> Retroactively blacklisted ${phone} to make them visible in admin.`);
    }
  }
}

findRecentCancellers()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
