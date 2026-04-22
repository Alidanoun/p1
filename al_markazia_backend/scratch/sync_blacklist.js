const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function syncSpamToBlacklist() {
  console.log('--- Syncing active spam blocks to Blacklist System ---');
  
  const settings = await prisma.systemSettings.findFirst();
  const CANCEL_LIMIT = settings?.spamCancelLimit ?? 3;
  const TIME_WINDOW_MINUTES = settings?.spamTimeWindowMinutes ?? 30;
  const windowStart = new Date(Date.now() - TIME_WINDOW_MINUTES * 60 * 1000);
  
  // Find users with recent cancellations
  const recentCancellations = await prisma.orderCancellation.groupBy({
    by: ['orderId'],
    where: { createdAt: { gte: windowStart } },
    _count: true
  });
  
  // This is a bit complex with prisma query groups. 
  // Let's just find customers who cancelled recently.
  const customers = await prisma.customer.findMany({
    include: {
      orders: {
        where: {
          cancellation: { createdAt: { gte: windowStart } }
        }
      }
    }
  });

  let synced = 0;
  for (const customer of customers) {
    if (customer.orders.length >= CANCEL_LIMIT && !customer.isBlacklisted) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: {
          isBlacklisted: true,
          blacklistUntil: new Date(Date.now() + 15 * 60 * 1000), // Give them 15 more mins
          blacklistReason: 'مزامنة تلقائية للحظر النشط (تجاوز حد الإلغاءات)',
          blacklistType: 'auto',
          blacklistedAt: new Date()
        }
      });
      console.log(`Synced customer: ${customer.phone}`);
      synced++;
    }
  }

  console.log(`Done. Synced ${synced} customers.`);
}

syncSpamToBlacklist()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
