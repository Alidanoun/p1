const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.workingHour.findMany().then(console.log).finally(() => prisma.$disconnect());
