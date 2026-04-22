const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.systemSettings.upsert({
    where: { key: 'cancellation_compensation_points' },
    update: {},
    create: {
      key: 'cancellation_compensation_points',
      value: '50'
    }
  });
  console.log('Settings initialized.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
