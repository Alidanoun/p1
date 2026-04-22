const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const customerCount = await prisma.customer.count();
    const customers = await prisma.customer.findMany({ take: 5 });
    
    console.log('--- DATABASE DIAGNOSTIC ---');
    console.log('Total Customers:', customerCount);
    console.log('First 5 Customers:', JSON.stringify(customers, null, 2));
    console.log('---------------------------');
  } catch (error) {
    console.error('Database connection error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
