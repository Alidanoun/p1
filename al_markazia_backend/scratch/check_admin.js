const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkAdmin() {
  try {
    const users = await prisma.user.findMany({
      where: {
        email: {
          contains: 'admin'
        }
      }
    });
    console.log('Admin users found:', users.map(u => ({ email: u.email, role: u.role })));
  } catch (error) {
    console.error('Error checking users:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkAdmin();
