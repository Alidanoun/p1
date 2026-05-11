const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seedData() {
  console.log('ℹ️ Seeding skipped by request to prevent constant conflicts.');
}

seedData().catch(console.error).finally(() => prisma.$disconnect());
