const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const users = await prisma.user.findMany();
  console.log('Users:', users.map(u => ({ email: u.email, role: u.role })));
  
  const settings = await prisma.restaurantSettings.findMany();
  console.log('Settings:', settings);
  
  const hours = await prisma.workingHour.findMany();
  console.log('Hours count:', hours.length);

  const logs = await prisma.systemAuditLog.findMany({ take: 5, orderBy: { createdAt: 'desc' } });
  console.log('Latest Logs:', logs.map(l => ({ action: l.action, branchId: l.branchId })));
  
  process.exit(0);
}

check();
