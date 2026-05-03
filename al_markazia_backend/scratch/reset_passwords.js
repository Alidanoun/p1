const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function resetPasswords() {
  const hashedPassword = await bcrypt.hash('123456', 10);
  
  const emails = [
    'admin@almarkazia.com',
    'admin@admin.com',
    'city@almarkazia.com',
    'khalda@almarkazia.com'
  ];

  for (const email of emails) {
    try {
      await prisma.user.update({
        where: { email },
        data: { 
          password: hashedPassword,
          isActive: true,
          failedAttempts: 0,
          lockUntil: null
        }
      });
      console.log(`✅ Password reset for: ${email}`);
    } catch (err) {
      console.log(`❌ Could not find/reset user: ${email}`);
    }
  }
}

resetPasswords().finally(() => prisma.$disconnect());
