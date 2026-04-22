const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
  console.log('🧹 Cleaning database...');
  await prisma.notification.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.item.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();

  console.log('🌱 Seeding database...');
  const hashedPassword = await bcrypt.hash('123456', 10);
  
  const admin = await prisma.user.create({
    data: {
      email: 'admin@admin.com',
      password: hashedPassword,
      role: 'admin',
    }
  });

  const category = await prisma.category.create({
    data: {
      name: 'الوجبات السريعة',
      description: 'ألذ الوجبات السريعة والطازجة',
      isActive: true,
      sortOrder: 1,
    }
  });

  const item1 = await prisma.item.create({
    data: {
      title: 'برجر كلاسيك',
      description: 'لحم بقري مشوي مع الخس والطماطم والجبنة',
      basePrice: 5.5,
      categoryId: category.id,
      isAvailable: true,
      isFeatured: true,
    }
  });

  const item2 = await prisma.item.create({
    data: {
      title: 'بيتزا مارجريتا',
      description: 'صلصة طماطم ايطالية مع جبنة الموزاريلا والريحان',
      basePrice: 7.0,
      categoryId: category.id,
      isAvailable: true,
    }
  });

  const item3 = await prisma.item.create({
    data: {
      title: 'بطاطس مقلية',
      description: 'بطاطس مقرمشة مملحة',
      basePrice: 2.0,
      categoryId: category.id,
      isAvailable: true,
    }
  });

  console.log('🚚 Seeding Delivery Zones...');
  const zones = [
    { nameAr: 'عمان - الدوار السابع', nameEn: 'Amman - 7th Circle', fee: 1.5, minOrder: 5.0 },
    { nameAr: 'خلدا', nameEn: 'Khalda', fee: 1.0, minOrder: 3.0 },
    { nameAr: 'عبدون', nameEn: 'Abdoun', fee: 2.0, minOrder: 10.0 },
    { nameAr: 'تلاع العلي', nameEn: 'Tla\'a Al-Ali', fee: 1.25, minOrder: 5.0 },
    { nameAr: 'شارع المدينة المنورة', nameEn: 'Madina St.', fee: 1.0, minOrder: 0.0 },
  ];

  for (const zone of zones) {
    await prisma.deliveryZone.upsert({
      where: { nameAr: zone.nameAr },
      update: {},
      create: {
        ...zone,
        isActive: true,
      }
    });
  }

  console.log('⚙️ Initializing System Settings...');
  await prisma.systemSettings.upsert({
    where: { key: 'delivery_config' },
    update: {},
    create: {
      key: 'delivery_config',
      value: 'active',
      defaultDeliveryFee: 1.0,
      freeCancelWindowMinutes: 5,
      spamCancelLimit: 3,
      spamTimeWindowMinutes: 30
    }
  });

  console.log('✅ Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
