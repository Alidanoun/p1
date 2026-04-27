const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash('123456', 10);
  
  const user = await prisma.user.upsert({
    where: { email: 'admin@almarkazia.com' },
    update: {
      password: hashedPassword,
      role: 'admin',
      isActive: true
    },
    create: {
      email: 'admin@almarkazia.com',
      password: hashedPassword,
      role: 'admin',
      name: 'Admin Al-Markazia',
      isActive: true
    }
  });

  console.log('✅ Admin user created/updated:', user.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
