const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const { encrypt, hashBlind } = require('../src/utils/crypto');
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
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@almarkazia.com';
  const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || '123456';
  const hashedPassword = await bcrypt.hash(adminPassword, 12);
  const emailHash = hashBlind(adminEmail);

  console.log(`🌱 Seeding Admin: ${adminEmail}`);
  
  const admin = await prisma.user.upsert({
    where: { emailHash },
    update: {
      password: hashedPassword,
      isActive: true,
      role: 'admin'
    },
    create: {
      email: encrypt(adminEmail),
      emailHash: emailHash,
      name: encrypt('System Administrator'),
      password: hashedPassword,
      role: 'admin',
      isActive: true
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

  console.log('🍽️ Initializing Restaurant Settings...');
  await prisma.restaurantSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      timezone: 'Asia/Amman',
      isEmergencyClosed: false,
      lastOrderMinutesBeforeClose: 15
    }
  });

  console.log('⏰ Initializing Working Hours...');
  const workingHours = [
    { dayOfWeek: 0, openTime: '09:00', closeTime: '23:00' }, // Sunday
    { dayOfWeek: 1, openTime: '09:00', closeTime: '23:00' }, // Monday
    { dayOfWeek: 2, openTime: '09:00', closeTime: '23:00' }, // Tuesday
    { dayOfWeek: 3, openTime: '09:00', closeTime: '23:00' }, // Wednesday
    { dayOfWeek: 4, openTime: '09:00', closeTime: '23:00' }, // Thursday (Late Night)
    { dayOfWeek: 5, openTime: '09:00', closeTime: '23:00' }, // Friday (Late Night)
    { dayOfWeek: 6, openTime: '09:00', closeTime: '23:00' }, // Saturday
  ];

  for (const hour of workingHours) {
    await prisma.workingHour.upsert({
      where: { dayOfWeek: hour.dayOfWeek },
      update: hour,
      create: hour
    });
  }

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
