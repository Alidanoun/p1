const { encrypt, hashBlind } = require('./src/utils/crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcrypt');

async function fixAdmin() {
  const users = await prisma.user.findMany({ where: { role: 'ADMIN' } });
  
  if (users.length > 0) {
    const admin = users[0];
    
    const newEmail = 'admin@almarkazia.com';
    const newPassword = 'Almarkazia123@';
    
    const encryptedEmail = encrypt(newEmail.toLowerCase().trim());
    const blindedEmail = hashBlind(newEmail.toLowerCase().trim());
    const passwordHash = await bcrypt.hash(newPassword, 10);
    
    await prisma.user.update({
      where: { id: admin.id },
      data: { 
        email: encryptedEmail,
        emailHash: blindedEmail,
        password: passwordHash,
        failedAttempts: 0,
        lockUntil: null
      }
    });
    
    // Clear lockout from Redis just in case
    const redis = require('./src/lib/redis');
    await redis.del(`login_fail:${blindedEmail}`);
    await redis.quitAll();
    
    console.log('✅ Admin credentials fully reset!');
    console.log('Email:', newEmail);
    console.log('Password:', newPassword);
    
  } else {
    console.log('No admin found!');
  }
  await prisma.$disconnect();
}

fixAdmin().catch(console.error);
