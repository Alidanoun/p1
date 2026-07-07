const { PrismaClient } = require('@prisma/client');
const { decrypt } = require('../src/utils/crypto');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function verify() {
  console.log('--- Verifying Admin Credentials ---');
  try {
    const admin = await prisma.user.findFirst({
      where: { role: 'ADMIN', uuid: 'b5083650-97e9-4a59-9914-19767f095fb8' }
    });

    if (!admin) {
      console.log('❌ Repaired Admin user not found by UUID!');
      return;
    }

    const decryptedEmail = decrypt(admin.email);
    const decryptedName = decrypt(admin.name);
    console.log(`User ID: ${admin.id}`);
    console.log(`Name: ${decryptedName}`);
    console.log(`Email: ${decryptedEmail}`);
    console.log(`Is Active: ${admin.isActive}`);

    // Verify password 'Almarkazia123@'
    const testPassword = 'Almarkazia123@';
    const isMatch = await bcrypt.compare(testPassword, admin.password);
    if (isMatch) {
      console.log(`✅ Password verification for "${testPassword}" succeeded!`);
    } else {
      console.log(`❌ Password verification for "${testPassword}" failed!`);
    }
  } catch (err) {
    console.error('Error during verification:', err);
  } finally {
    await prisma.$disconnect();
  }
}

verify();
