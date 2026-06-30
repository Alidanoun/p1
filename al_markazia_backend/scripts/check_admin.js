const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient();

async function main() {
  // Find the ADMIN user
  const admin = await p.user.findFirst({
    where: { role: 'ADMIN' },
    select: { id: true, email: true, role: true, isActive: true, name: true }
  });
  console.log('=== Current ADMIN user ===');
  console.log(JSON.stringify(admin, null, 2));

  if (!admin) {
    console.log('❌ No ADMIN user found! Creating one...');
    const hashed = await bcrypt.hash('Admin123', 12);
    const newAdmin = await p.user.create({
      data: {
        email: 'admin@almarkazia.com',
        password: hashed,
        name: 'Admin',
        role: 'ADMIN',
        isActive: true,
      }
    });
    console.log('✅ Created:', newAdmin.email);
    return;
  }

  // Reset password to Admin123
  const hashed = await bcrypt.hash('Admin123', 12);
  await p.user.update({
    where: { id: admin.id },
    data: { password: hashed }
  });
  console.log('\n✅ Password reset to Admin123 for user ID:', admin.id);
  console.log('ℹ️  The email shown above is encrypted. Use the email from your .env or seed script.');
}

main()
  .catch(e => console.error(e))
  .finally(() => p.$disconnect());
