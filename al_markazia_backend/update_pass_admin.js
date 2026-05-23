const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const hashedPassword = await bcrypt.hash('Almarkazia123@', 12);
  const result = await prisma.user.updateMany({
    where: { role: 'ADMIN' },
    data: { password: hashedPassword }
  });
  console.log(`Password updated successfully. Updated ${result.count} admin user(s).`);
}
run().catch(console.error).finally(() => prisma.$disconnect());
