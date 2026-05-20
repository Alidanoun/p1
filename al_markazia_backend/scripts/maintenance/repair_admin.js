const { PrismaClient } = require('@prisma/client');
const { encrypt, hashBlind } = require('../../src/utils/crypto');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function repairAdmin() {
  const email = 'admin@almarkazia.com';
  const password = '123456';
  const name = 'Admin';
  
  console.log('🔧 Repairing Admin Account...');
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const encryptedEmail = encrypt(email);
    const emailHash = hashBlind(email);
    const encryptedName = encrypt(name);

    // Upsert the user
    const user = await prisma.user.upsert({
      where: { email: encryptedEmail }, // This might be tricky if it's already there but not encrypted
      update: {
        email: encryptedEmail,
        emailHash: emailHash,
        password: hashedPassword,
        name: encryptedName,
        isActive: true,
        failedAttempts: 0,
        lockUntil: null
      },
      create: {
        email: encryptedEmail,
        emailHash: emailHash,
        password: hashedPassword,
        name: encryptedName,
        role: 'ADMIN',
        isActive: true,
        uuid: 'b5083650-97e9-4a59-9914-19767f095fb8' // Use the one from the previous logs if possible
      }
    });

    // Also check if there's an unencrypted one and delete it
    const allUsers = await prisma.user.findMany();
    for (const u of allUsers) {
      if (u.email === email || u.email === 'admin@admin.com') {
         console.log(`🗑️ Deleting legacy/unencrypted user: ${u.email}`);
         await prisma.user.delete({ where: { id: u.id } });
      }
    }

    console.log('✅ Admin account repaired and secured.');
  } catch (err) {
    console.error('❌ Repair failed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

repairAdmin();
