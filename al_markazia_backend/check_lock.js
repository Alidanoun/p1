const prisma = require('./src/lib/prisma');
const { hashBlind } = require('./src/utils/crypto');

async function main() {
    const email = 'admin@almarkazia.com';
    const emailHash = hashBlind(email.toLowerCase().trim());

    const user = await prisma.user.findUnique({
        where: { emailHash }
    });

    console.log(user.failedAttempts);
    console.log(user.lockUntil);
}
main().catch(console.error).finally(() => prisma.$disconnect());
