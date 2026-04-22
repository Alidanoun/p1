const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixOrder() {
  try {
    const order = await prisma.order.findUnique({ where: { id: 8 } });
    if (order && order.status === 'pending') {
      await prisma.order.update({
        where: { id: 8 },
        data: { status: 'preparing', updatedAt: new Date() }
      });
      console.log('Successfully fixed Order 8 status to preparing');
    } else {
      console.log('Order 8 already processed or not found:', order?.status);
    }
  } catch (e) {
    console.error('Fix failed:', e);
  } finally {
    await prisma.$disconnect();
  }
}

fixOrder();
