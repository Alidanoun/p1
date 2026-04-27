const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const customers = await prisma.customer.findMany({
    select: { email: true, phone: true, name: true }
  });
  console.log('Customers:', JSON.stringify(customers, null, 2));
  
  const users = await prisma.user.findMany({
    select: { email: true, name: true, role: true }
  });
  console.log('Users (Admins):', JSON.stringify(users, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
