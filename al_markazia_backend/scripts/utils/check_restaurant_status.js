const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkStatus() {
  try {
    const settings = await prisma.restaurantSettings.findFirst();
    const hours = await prisma.workingHour.findMany();
    
    console.log('--- Restaurant Settings ---');
    console.log(JSON.stringify(settings, null, 2));
    
    console.log('\n--- Working Hours ---');
    console.log(JSON.stringify(hours, null, 2));
    
    const now = new Date();
    console.log('\n--- Current System Time ---');
    console.log(now.toString());
    console.log(now.toISOString());
    
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

checkStatus();
