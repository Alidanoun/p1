require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { hashBlind, decrypt } = require('../src/utils/crypto');
const prisma = new PrismaClient();

async function forensicAudit() {
  console.log('\n--- [ Forensic Database Audit: Admin Users ] ---');
  
  try {
    const users = await prisma.user.findMany({
      where: { role: 'admin' },
      include: { branch: true }
    });

    if (users.length === 0) {
      console.log('🔴 No Admin users found in database.');
      return;
    }

    for (const user of users) {
      const decryptedEmail = decrypt(user.email);
      const expectedHash = hashBlind(decryptedEmail.toLowerCase().trim());
      const hashMatch = user.emailHash === expectedHash;
      
      console.log(`\n👤 Admin: ${decrypt(user.name) || 'Unnamed'}`);
      console.log(`   Email (Decrypted): ${decryptedEmail}`);
      console.log(`   Email Hash in DB:  ${user.emailHash}`);
      console.log(`   Expected Hash:     ${expectedHash}`);
      console.log(`   Hash Consistency:  ${hashMatch ? '✅ MATCH' : '❌ MISMATCH'}`);
      console.log(`   Active Status:     ${user.isActive ? '✅ ACTIVE' : '❌ INACTIVE'}`);
      console.log(`   Password Set:      ${user.password ? '✅ YES' : '❌ NO'}`);
      console.log(`   Role:              ${user.role}`);
      console.log(`   Branch ID:         ${user.branchId || 'Global'}`);
    }

    console.log('\n--- [ Environmental Variables Check ] ---');
    console.log(`   NODE_ENV:             ${process.env.NODE_ENV}`);
    console.log(`   PORT:                 ${process.env.PORT}`);
    console.log(`   JWT_SECRET Presence:  ${process.env.JWT_SECRET ? '✅' : '❌'}`);
    console.log(`   ENCRYPTION_KEY Presence: ${process.env.ENCRYPTION_KEY ? '✅' : '❌'}`);

  } catch (err) {
    console.error('💥 Audit failed:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

forensicAudit();
