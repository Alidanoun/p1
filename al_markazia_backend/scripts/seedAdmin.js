const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function seedAdmin() {
  const email = 'admin@almarkazia.com';
  const password = await bcrypt.hash('admin123', 10);
  console.log('Generated hash for admin123:', password);
  
  const existingAdmin = await prisma.user.findUnique({ where: { email } });
  if (existingAdmin) {
    await prisma.user.update({
      where: { email },
      data: { password }
    });
    console.log('Admin password updated.');
    return;
  }

  const admin = await prisma.user.create({
    data: {
      email,
      password,
      role: 'super_admin'
    }
  });

  console.log('Super Admin Created:');
  console.log('Email:', email);
  console.log('Password:', 'admin123');
}

seedAdmin().catch(console.error).finally(() => prisma.$disconnect());
