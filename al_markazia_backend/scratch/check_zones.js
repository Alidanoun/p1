const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkZones() {
  const count = await prisma.deliveryZone.count();
  const activeCount = await prisma.deliveryZone.count({ where: { isActive: true } });
  const sample = await prisma.deliveryZone.findMany({ take: 1 });
  
  console.log('Total Delivery Zones:', count);
  console.log('Active Delivery Zones:', activeCount);
  console.log('Sample Zone:', JSON.stringify(sample, null, 2));
  
  process.exit(0);
}

checkZones();
