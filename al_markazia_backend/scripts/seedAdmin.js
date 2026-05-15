const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const { encrypt, hashBlind } = require('../src/utils/crypto');
const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL || 'admin@almarkazia.com';
  const password = process.env.ADMIN_DEFAULT_PASSWORD || 'admin123';
  
  const emailHash = hashBlind(email.toLowerCase().trim());
  const encryptedEmail = encrypt(email.toLowerCase().trim());
  const hashedPassword = await bcrypt.hash(password, 12);

  console.log(`🚀 Seeding Admin: ${email}`);

  await prisma.user.upsert({
    where: { emailHash },
    update: {
      password: hashedPassword,
      isActive: true,
      role: 'admin',
      failedAttempts: 0,
      lockUntil: null
    },
    create: {
      email: encryptedEmail,
      emailHash: emailHash,
      password: hashedPassword,
      name: encrypt('System Administrator'),
      role: 'admin',
      isActive: true
    }
  });

  console.log('✅ Admin seeded successfully!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
