const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Starting UUID population script...');

  // 1. Populate Customers
  const customers = await prisma.customer.findMany({
    where: { uuid: null }
  });
  console.log(`Found ${customers.length} customers with empty UUIDs.`);

  for (const customer of customers) {
    const newUuid = crypto.randomUUID();
    await prisma.customer.update({
      where: { id: customer.id },
      data: { uuid: newUuid }
    });
    console.log(`✅ Updated Customer ${customer.id} with UUID: ${newUuid}`);
  }

  // 2. Populate Users (Admins)
  const users = await prisma.user.findMany({
    where: { uuid: null }
  });
  console.log(`Found ${users.length} users with empty UUIDs.`);

  for (const user of users) {
    const newUuid = crypto.randomUUID();
    await prisma.user.update({
      where: { id: user.id },
      data: { uuid: newUuid }
    });
    console.log(`✅ Updated User ${user.id} with UUID: ${newUuid}`);
  }

  console.log('✨ UUID population complete!');
}

main()
  .catch((e) => {
    console.error('❌ Error during population:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
