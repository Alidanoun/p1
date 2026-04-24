const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seedData() {
  // 1. Seed System Settings
  const settingsCount = await prisma.systemSettings.count();
  if (settingsCount === 0) {
    await prisma.systemSettings.create({
      data: {
        key: 'global_config',
        value: JSON.stringify({ isStoreOpen: true, currency: 'JOD' }),
        freeCancelWindowMinutes: 5,
        spamCancelLimit: 3,
        spamTimeWindowMinutes: 30,
        defaultDeliveryFee: 1.00
      }
    });
    console.log('✅ System Settings seeded');
  }

  // 2. Seed Delivery Zones
  const zonesCount = await prisma.deliveryZone.count();
  if (zonesCount === 0) {
    await prisma.deliveryZone.createMany({
      data: [
        { nameAr: 'عمان - المنطقة الأولى', nameEn: 'Amman - Zone 1', fee: 1.00, minOrder: 5.00, sortOrder: 1 },
        { nameAr: 'عمان - المنطقة الثانية', nameEn: 'Amman - Zone 2', fee: 1.50, minOrder: 10.00, sortOrder: 2 },
        { nameAr: 'الزرقاء', nameEn: 'Zarqa', fee: 2.50, minOrder: 15.00, sortOrder: 3 },
      ]
    });
    console.log('✅ Delivery Zones seeded');
  } else {
    console.log('Delivery Zones already exist.');
  }
}

seedData().catch(console.error).finally(() => prisma.$disconnect());
