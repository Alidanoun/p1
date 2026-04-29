const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Restaurant Working Hours...');

  // 1. Initial Settings
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

  // 2. Weekly Schedule (0=Sun to 6=Sat)
  const defaultSchedule = [
    { dayOfWeek: 0, openTime: '09:00', closeTime: '23:30', isClosed: false },
    { dayOfWeek: 1, openTime: '09:00', closeTime: '23:30', isClosed: false },
    { dayOfWeek: 2, openTime: '09:00', closeTime: '23:30', isClosed: false },
    { dayOfWeek: 3, openTime: '09:00', closeTime: '23:30', isClosed: false },
    { dayOfWeek: 4, openTime: '09:00', closeTime: '01:00', isClosed: false }, // Late night Fri
    { dayOfWeek: 5, openTime: '09:00', closeTime: '01:00', isClosed: false }, // Late night Sat
    { dayOfWeek: 6, openTime: '09:00', closeTime: '23:30', isClosed: false },
  ];

  for (const day of defaultSchedule) {
    await prisma.workingHour.upsert({
      where: { dayOfWeek: day.dayOfWeek },
      update: {},
      create: day
    });
  }

  console.log('✅ Restaurant schedule seeded!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
