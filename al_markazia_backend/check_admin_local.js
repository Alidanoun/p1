const bcrypt = require('bcrypt');
const prisma = require('./src/lib/prisma');
const { hashBlind } = require('./src/utils/crypto');

async function main() {
    const email = 'admin@almarkazia.com';
    const emailHash = hashBlind(email.toLowerCase().trim());
    console.log('Email Hash:', emailHash);

    const user = await prisma.user.findUnique({
        where: { emailHash }
    });

    if (user) {
        console.log('User found:', user.email);
        const match = await bcrypt.compare('Admin123', user.password);
        console.log('Password match:', match);
    } else {
        console.log('User not found!');
        
        // Find by role admin?
        const admins = await prisma.user.findMany({
            where: { role: 'ADMIN' }
        });
        console.log('Found admins:', admins.length);
        if (admins.length > 0) {
            console.log('Admin 1 UUID:', admins[0].uuid);
            console.log('Admin 1 Email Hash:', admins[0].emailHash);
        }
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
