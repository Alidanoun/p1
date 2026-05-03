const { DateTime } = require('luxon');
const prisma = require('../src/lib/prisma');
const workingHoursService = require('../src/services/workingHoursService');

async function debugStatus() {
  try {
    const settings = await prisma.restaurantSettings.findFirst({ where: { id: 1 } });
    const schedule = await prisma.workingHour.findMany();
    
    console.log('--- Settings ---');
    console.log(JSON.stringify(settings, null, 2));
    
    console.log('\n--- Schedule ---');
    console.log(JSON.stringify(schedule, null, 2));
    
    const now = DateTime.now().setZone(settings.timezone);
    console.log(`\nNow (Amman): ${now.toString()}`);
    console.log(`Weekday (Luxon): ${now.weekday}`);
    const dayOfWeek = now.weekday === 7 ? 0 : now.weekday;
    console.log(`Mapped DayOfWeek: ${dayOfWeek}`);
    
    const todaySchedule = schedule.find(s => s.dayOfWeek === dayOfWeek);
    console.log(`\nToday Schedule: ${JSON.stringify(todaySchedule, null, 2)}`);
    
    const status = await workingHoursService.getStatus();
    console.log('\n--- Final Status Result ---');
    console.log(JSON.stringify(status, null, 2));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugStatus();
