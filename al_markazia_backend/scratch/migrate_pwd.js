const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function migrate() {
  try {
    const pwd = 'AlMarkazia@2026';
    await prisma.systemSettings.upsert({
      where: { key: 'manager_password' },
      update: { value: pwd },
      create: { key: 'manager_password', value: pwd }
    });
    console.log('Successfully migrated manager password to SystemSettings');
  } catch (e) {
    console.error('Migration failed:', e);
  } finally {
    await prisma.$disconnect();
  }
}

migrate();
