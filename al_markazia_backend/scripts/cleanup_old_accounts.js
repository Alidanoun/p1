const { PrismaClient } = require('@prisma/client');
const { decrypt } = require('../src/utils/crypto');
const prisma = new PrismaClient();

async function cleanup() {
  console.log('🧹 Cleaning up old accounts encrypted with OLD key...\n');

  const users = await prisma.user.findMany();
  let deleted = 0;

  for (const u of users) {
    try {
      const email = decrypt(u.email);
      console.log(`  ✅ ID ${u.id}: ${email} — valid encryption, keeping`);
    } catch (e) {
      console.log(`  🗑️  ID ${u.id}: ${u.role} — OLD encryption, deleting...`);
      await prisma.user.delete({ where: { id: u.id } });
      deleted++;
    }
  }

  console.log(`\n✅ Cleanup complete. Deleted ${deleted} old accounts.`);
  await prisma.$disconnect();
}

cleanup();
