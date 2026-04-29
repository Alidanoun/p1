const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkSchedule() {
  try {
    const schedule = await prisma.workingHour.findMany();
    const settings = await prisma.restaurantSettings.findFirst();
    console.log('Settings:', settings);
    console.log('Schedule:', schedule);
  } catch (error) {
    console.error('Error checking schedule:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkSchedule();
