const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');

async function run() {
  const hashedPassword = await bcrypt.hash('Almarkazia123@', 12);
  const emailHash = crypto.createHash('sha256').update('admin@almarkazia.com').digest('hex');
  await prisma.user.updateMany({ where: { emailHash }, data: { password: hashedPassword } });
  console.log('Password updated successfully');
}
run().catch(console.error).finally(() => prisma.$disconnect());
