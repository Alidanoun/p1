require('dotenv').config();
const { encrypt, decrypt, hashBlind } = require('../src/utils/crypto');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * 🧪 Auth Fix Validation Script
 * Verifies encryption roundtrip and database lookup logic.
 */
async function validate() {
  console.log('\n🧪 Starting Auth Validation Tests...');

  try {
    // 1. Test Crypto Roundtrip
    const testEmail = 'test-' + Date.now() + '@example.com';
    const encrypted = encrypt(testEmail);
    const decrypted = decrypt(encrypted);
    const hashed = hashBlind(testEmail);

    console.log('✅ Crypto Roundtrip:', decrypted === testEmail ? 'PASSED' : 'FAILED');
    console.log('✅ Hashing Logic:', hashed && hashed.length === 64 ? 'PASSED' : 'FAILED');

    // 2. Test DB Lookup Simulation
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@almarkazia.com';
    const adminHash = hashBlind(adminEmail);
    
    console.log(`\n🔍 Searching for Admin with hash: ${adminHash.substring(0, 10)}...`);
    
    const admin = await prisma.user.findUnique({
      where: { emailHash: adminHash }
    });

    if (admin) {
      console.log('✅ Admin Lookup: PASSED');
      console.log('✅ Admin Data Encryption:', admin.email.includes(':') ? 'PASSED' : 'FAILED (Plain text detected)');
      
      const plainEmail = decrypt(admin.email);
      console.log('✅ Admin Email Decryption:', plainEmail === adminEmail ? 'PASSED' : `FAILED (Expected ${adminEmail}, got ${plainEmail})`);
    } else {
      console.log('❌ Admin Lookup: FAILED (User not found in DB)');
      console.log('💡 Hint: Run "node scripts/repairLegacyUsers.js" or "npx prisma db seed" first.');
    }

    // 3. Test JWT Environment
    const jwt = require('jsonwebtoken');
    const { JWT_PRIVATE_KEY, REFRESH_TOKEN_SECRET } = require('../src/config/secrets');
    
    try {
      const token = jwt.sign({ test: true }, JWT_PRIVATE_KEY, { algorithm: 'RS256', expiresIn: '1m' });
      console.log('✅ JWT Signing (RSA): PASSED');
    } catch (e) {
      console.log('❌ JWT Signing (RSA): FAILED', e.message);
    }

    console.log('\n🏁 Validation Finished.');

  } catch (err) {
    console.error('💥 Validation crashed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

validate();
