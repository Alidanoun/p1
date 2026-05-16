require('dotenv').config();
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testLoginFlow() {
  console.log('\n--- [ Testing Login Flow ] ---');
  const baseUrl = `http://localhost:${process.env.PORT || 5000}/api/v1`;
  
  try {
    // 1. Attempt login with known credentials
    const credentials = {
      email: 'admin@almarkazia.com',
      password: 'admin123' // From .env
    };

    console.log(`📡 Sending login request for ${credentials.email}...`);
    const response = await axios.post(`${baseUrl}/auth/login`, credentials);
    
    if (response.data.success) {
      console.log('✅ Login Successful!');
      const { accessToken, user } = response.data.data;
      console.log(`   User: ${user.name} (${user.role})`);
      
      // 2. Check Database for Refresh Token
      const tokenRecord = await prisma.refreshToken.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' }
      });
      
      if (tokenRecord) {
        console.log('✅ Refresh Token persisted in Database.');
        console.log(`   JTI: ${tokenRecord.jti}`);
        console.log(`   Family: ${tokenRecord.tokenFamily}`);
      } else {
        console.log('❌ Refresh Token NOT found in Database.');
      }
    } else {
      console.log('❌ Login Failed:', response.data.error);
    }
  } catch (err) {
    console.error('💥 Request Failed:', err.response?.data?.error || err.message);
  } finally {
    await prisma.$disconnect();
  }
}

testLoginFlow();
