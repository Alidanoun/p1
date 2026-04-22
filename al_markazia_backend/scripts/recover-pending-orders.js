const prisma = require('../src/lib/prisma');
const { performStatusUpdate } = require('../src/controllers/orderController');

async function main() {
  console.log('🚑 Starting Recovery for pending orders...');
  
  try {
    const pendingOrders = await prisma.order.findMany({
      where: { status: 'pending' },
      select: { id: true, orderNumber: true }
    });

    console.log(`Found ${pendingOrders.length} pending orders.`);

    for (const order of pendingOrders) {
      const result = await performStatusUpdate(order.id, 'preparing');
      if (result) {
        console.log(`✅ Recovered Order ${order.orderNumber}`);
      } else {
        console.log(`⚠️ Skipped/Failed Order ${order.orderNumber}`);
      }
    }

    console.log('🏁 Recovery completed.');
  } catch (error) {
    console.error('❌ Recovery error:', error.message);
  }
  process.exit(0);
}

main();
