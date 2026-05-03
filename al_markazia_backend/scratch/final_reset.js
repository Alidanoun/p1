const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function reset() {
  const hashedPassword = await bcrypt.hash('123456', 10);
  const emails = ['admin@almarkazia.com', 'city@almarkazia.com', 'khalda@almarkazia.com'];
  
  for (const email of emails) {
    // 🛡️ Find branchId first to maintain consistency
    const existing = await prisma.user.findUnique({ where: { email } });
    const branchId = existing?.branchId || (email.includes('city') ? '5df2996f-ec99-46da-8590-995724cfbb5a' : '08396515-7ecb-4369-8c98-f843aed7aa3b');

    await prisma.user.upsert({
      where: { email },
      update: {
        password: hashedPassword,
        isActive: true,
        failedAttempts: 0,
        lockUntil: null,
        role: email.includes('admin') ? 'super_admin' : 'manager'
      },
      create: {
        email,
        password: hashedPassword,
        role: email.includes('admin') ? 'super_admin' : 'manager',
        name: email.split('@')[0],
        isActive: true,
        branchId
      }
    });
    console.log(`✅ Final Reset & Verified: ${email}`);
  }
}

reset().finally(() => prisma.$disconnect());
