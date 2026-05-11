const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seedAdmin() {
  console.log('ℹ️ Admin seeding skipped by request to prevent constant conflicts.');
}

seedAdmin().catch(console.error).finally(() => prisma.$disconnect());
