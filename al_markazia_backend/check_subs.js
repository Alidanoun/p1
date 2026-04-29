const prisma = require('./src/lib/prisma');
async function check() {
  const subs = await prisma.restaurantSubscription.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log('Recent Subscriptions:', JSON.stringify(subs, null, 2));
  process.exit(0);
}
check();
