const { PrismaClient } = require('@prisma/client');
const { decrypt } = require('../src/utils/crypto');
const prisma = new PrismaClient();

async function verify() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, role: true, branchId: true, isActive: true }
  });

  console.log('📋 All Users in Database:\n');
  for (const u of users) {
    try {
      const email = decrypt(u.email);
      console.log(`  ID: ${u.id} | Email: ${email} | Role: ${u.role} | Branch: ${u.branchId || 'ALL'} | Active: ${u.isActive}`);
    } catch (e) {
      console.log(`  ID: ${u.id} | Email: [ENCRYPTED] ${u.email.substring(0, 20)}... | Role: ${u.role}`);
    }
  }
  await prisma.$disconnect();
}

verify();
