const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkOrder() {
  const order = await prisma.order.findUnique({ where: { id: 1 } });
  console.log('Order #1 Status:', order ? order.status : 'NOT FOUND');
  process.exit(0);
}

checkOrder();
