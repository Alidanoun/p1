const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const container = require('./src/lib/container');

const { traceContext } = require('./src/utils/context');

async function seedRealData() {
  await traceContext.run({ bypassRls: true }, async () => {
    console.log('Deleting fake snapshots...');
    await prisma.dailyFinancialSnapshot.deleteMany({});
    
    const branches = await prisma.branch.findMany();
    
    const snapshotService = container.financialSnapshotService;
    
    for (const branch of branches) {
      console.log(`Generating real snapshots for branch ${branch.name}...`);
      for (let i = 6; i >= 0; i--) {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - i);
        await snapshotService.createDailySnapshot(branch.id, targetDate);
      }
    }
    
    console.log('Done!');
  });
}

seedRealData().then(() => prisma.$disconnect()).catch(e => {
  console.error(e);
  prisma.$disconnect();
});
