require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function checkAdminPassword() {
  console.log('\n--- [ Admin Password Forensic Check ] ---');
  
  try {
    const user = await prisma.user.findFirst({
      where: { emailHash: 'dfd61b4b91b5cf7cc54de28114b6fee660cb057450191e556aa7ca22bb1c64d6' } // admin@almarkazia.com
    });

    if (!user) {
      console.log('🔴 Admin user not found.');
      return;
    }

    const passwordsToTest = ['123456', 'admin123'];
    
    for (const pw of passwordsToTest) {
      const match = await bcrypt.compare(pw, user.password);
      console.log(`🔑 Testing '${pw}': ${match ? '✅ MATCH' : '❌ NO MATCH'}`);
    }

    console.log(`👤 Active Status: ${user.isActive}`);
    console.log(`👤 Failed Attempts: ${user.failedAttempts}`);
    console.log(`👤 Lock Until: ${user.lockUntil}`);

  } catch (err) {
    console.error('💥 Error:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkAdminPassword();
