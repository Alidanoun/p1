const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const hours = await prisma.workingHour.findMany();
  console.log('--- Working Hours ---');
  console.log(JSON.stringify(hours, null, 2));
  
  const settings = await prisma.restaurantSettings.findFirst();
  console.log('--- Restaurant Settings ---');
  console.log(JSON.stringify(settings, null, 2));
  
  const branches = await prisma.branch.findMany();
  console.log('--- Branches ---');
  console.log(JSON.stringify(branches, null, 2));
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
