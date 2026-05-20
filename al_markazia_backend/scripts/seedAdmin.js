const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { encrypt, hashBlind } = require('../src/utils/crypto');
const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL || 'admin@almarkazia.com';

  // Accept password via CLI argument (--password=xxx) or generate a secure random one
  const args = process.argv.slice(2);
  const passwordArg = args.find(a => a.startsWith('--password='));
  const password = passwordArg ? passwordArg.split('=')[1] : crypto.randomBytes(16).toString('hex');

  const emailHash = hashBlind(email.toLowerCase().trim());
  const encryptedEmail = encrypt(email.toLowerCase().trim());
  const hashedPassword = await bcrypt.hash(password, 12);

  console.log(`🚀 Seeding Admin: ${email}`);
  console.log(`🔑 Admin Password: ${password}`);
  console.log('⚠️  Save this password — it will not be shown again.');

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
