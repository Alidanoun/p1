const prisma = require('../lib/prisma');
prisma.loyaltyConfig.findFirst().then(console.log).finally(() => process.exit());
