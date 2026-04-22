const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function reset() {
  try {
    const result = await prisma.item.updateMany({
      data: { excludeFromStats: false }
    });
    console.log(`Successfully reset ${result.count} items.`);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

reset();
