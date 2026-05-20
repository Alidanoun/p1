require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const TokenService = require('../src/services/tokenService');
const prisma = new PrismaClient();

async function verifyRotationLogic() {
  console.log('\n--- [ Final Logic Verification: Token Rotation ] ---');
  
  try {
    // 1. Find the admin user
    const user = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (!user) throw new Error('Admin user not found for test');

    console.log(`👤 Testing rotation for: ${user.uuid}`);

    // 2. Simulate Initial Login (Generate Token)
    console.log('🔄 Step 1: Generating initial refresh token...');
    const { token, jti } = await TokenService.generateAndSaveRefreshToken(user, { ip: '127.0.0.1' });
    console.log(`   Initial JTI: ${jti}`);

    // 3. Simulate First Rotation (The fix we just implemented)
    console.log('🔄 Step 2: Validating and Rotating for the first time...');
    const result1 = await TokenService.validateAndRotate(token, '127.0.0.1', 'test-fingerprint');
    console.log('   ✅ Rotation 1 successful.');
    console.log(`   New JTI: ${result1.newRefreshToken.jti}`);

    // 4. Test REUSE DETECTION (Try to rotate the same OLD token again)
    console.log('🔄 Step 3: Testing Reuse Detection (rotating the old token again)...');
    try {
      await TokenService.validateAndRotate(token, '127.0.0.1', 'test-fingerprint');
      console.log('   ❌ FAIL: Reuse should have been detected!');
    } catch (err) {
      if (err.message === 'TOKEN_REUSE_DETECTED') {
        console.log('   ✅ SUCCESS: Reuse detected and blocked correctly.');
      } else {
        console.log(`   ❓ Unexpected error: ${err.message}`);
      }
    }

    // 5. Verify the NEW token is still valid
    console.log('🔄 Step 4: Verifying the new token from Rotation 1 is still valid...');
    const result2 = await TokenService.validateAndRotate(result1.newRefreshToken.token, '127.0.0.1', 'test-fingerprint');
    console.log('   ✅ SUCCESS: Chain rotation works.');

  } catch (err) {
    console.error('💥 Verification failed:', err.message);
    console.error(err.stack);
  } finally {
    await prisma.$disconnect();
  }
}

verifyRotationLogic();
