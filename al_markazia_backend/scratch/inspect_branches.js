const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function inspectBranches() {
  const branches = await prisma.branch.findMany();
  console.log('Branches in DB:', JSON.stringify(branches, null, 2));
}

inspectBranches().finally(() => prisma.$disconnect());
