const { PrismaClient } = require('@prisma/client');
const { encrypt, hashBlind } = require('../../src/utils/crypto');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function seedBranches() {
  const password = 'branch123';
  const hashedPassword = await bcrypt.hash(password, 10);

  const branches = [
    { name: 'فرع خلدا', code: 'KHALDA', email: 'khalda@almarkazia.com' },
    { name: 'فرع المدينة', code: 'MADINA', email: 'madina@almarkazia.com' }
  ];

  console.log('🌱 Seeding Branches and Managers...');

  for (const b of branches) {
    // 1. Create or Update Branch
    const branch = await prisma.branch.upsert({
      where: { code: b.code },
      update: { name: b.name },
      create: {
        name: b.name,
        code: b.code,
        isActive: true
      }
    });

    // 2. Create or Update Manager
    const encryptedEmail = encrypt(b.email);
    const emailHash = hashBlind(b.email);

    await prisma.user.upsert({
      where: { emailHash: emailHash },
      update: {
        email: encryptedEmail,
        password: hashedPassword,
        branchId: branch.id,
        role: 'BRANCH_MANAGER',
        isActive: true
      },
      create: {
        email: encryptedEmail,
        emailHash: emailHash,
        name: encrypt(b.name + ' Manager'),
        password: hashedPassword,
        role: 'BRANCH_MANAGER',
        branchId: branch.id,
        isActive: true
      }
    });

    console.log(`✅ ${b.name}: ${b.email} / ${password}`);
  }
}

seedBranches()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
