const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  try {
    const catCount = await prisma.category.count();
    const activeCatCount = await prisma.category.count({ where: { isActive: true } });
    
    const itemCount = await prisma.item.count();
    const availableItemCount = await prisma.item.count({ where: { isAvailable: true } });
    const excludedItemCount = await prisma.item.count({ where: { excludeFromStats: true } });
    const nonExcludedItemCount = await prisma.item.count({ where: { excludeFromStats: false } });

    console.log({
      categories: { total: catCount, active: activeCatCount },
      items: { 
        total: itemCount, 
        available: availableItemCount, 
        excluded: excludedItemCount, 
        nonExcluded: nonExcludedItemCount 
      }
    });

    const sampleCategory = await prisma.category.findFirst();
    console.log('Sample Category:', sampleCategory);
    
    const sampleItem = await prisma.item.findFirst();
    console.log('Sample Item:', sampleItem);

  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

check();
