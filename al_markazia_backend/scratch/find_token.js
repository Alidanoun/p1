const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function findUserWithToken() {
  const customers = await prisma.customer.findMany({
    where: {
      fcmToken: { not: null }
    },
    take: 5
  });
  console.log('Customers with FCM tokens:');
  customers.forEach(c => {
    console.log(`ID: ${c.id}, Name: ${c.name}, Phone: ${c.phone}, Token: ${c.fcmToken}`);
  });
  process.exit(0);
}

findUserWithToken();
