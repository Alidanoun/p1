const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Starting super_admin to admin role migration...');
  
  const updatedUsers = await prisma.user.updateMany({
    where: {
      role: 'super_admin',
    },
    data: {
      role: 'admin',
    },
  });

  console.log(`Updated ${updatedUsers.count} users from super_admin to admin.`);
  console.log('Migration complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
