const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function hashBlind(text) {
  const BLIND_INDEX_SECRET = process.env.BLIND_INDEX_SECRET || 'fallback_blind_secret_12345';
  return crypto.createHmac('sha256', BLIND_INDEX_SECRET).update(text).digest('hex');
}

async function checkAdmin() {
  const users = await prisma.user.findMany({
    where: { role: 'ADMIN' }
  });
  
  const testEmail = 'admin@almarkazia.com';
  const testPassword = 'Almarkazia123@';
  
  const blindedEmail = hashBlind(testEmail.toLowerCase().trim());
  console.log('Testing Email:', testEmail);
  console.log('Computed Blind Hash:', blindedEmail);

  for (const u of users) {
    console.log('---------------------------');
    console.log('Admin ID:', u.id);
    console.log('Admin Email Hash in DB:', u.emailHash);
    console.log('Admin Password Hash in DB:', u.password);
    
    if (u.emailHash === blindedEmail) {
      console.log('✅ Email hash matches!');
    } else {
      console.log('❌ Email hash DOES NOT match!');
    }
    
    const isPasswordMatch = await bcrypt.compare(testPassword, u.password);
    if (isPasswordMatch) {
      console.log('✅ Password matches!');
    } else {
      console.log('❌ Password DOES NOT match!');
    }
  }
  
  await prisma.$disconnect();
}

checkAdmin().catch(console.error);
