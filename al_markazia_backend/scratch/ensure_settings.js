const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function ensureSettings() {
  try {
    const settings = await prisma.restaurantSettings.findFirst();
    if (!settings) {
      console.log('No settings found. Creating default...');
      await prisma.restaurantSettings.create({
        data: {
          id: 1,
          timezone: 'Asia/Amman',
          isEmergencyClosed: false,
          lastOrderMinutesBeforeClose: 15
        }
      });
      console.log('Settings created successfully.');
    } else {
      console.log('Settings already exist:', settings);
    }
  } catch (error) {
    console.error('Error ensuring settings:', error);
  } finally {
    await prisma.$disconnect();
  }
}

ensureSettings();
