const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function testLogin(email, password) {
  console.log(`Testing login for: ${email}`);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) {
    console.log('❌ User not found');
    return;
  }
  
  const match = await bcrypt.compare(password, user.password);
  console.log(`Login Result: ${match ? '✅ SUCCESS' : '❌ FAILED'}`);
  console.log('User Role:', user.role);
  console.log('User Branch:', user.branchId);
}

async function runTests() {
  await testLogin('admin@almarkazia.com', '123456');
  await testLogin('city@almarkazia.com', '123456');
  await testLogin('khalda@almarkazia.com', '123456');
}

runTests().finally(() => prisma.$disconnect());
