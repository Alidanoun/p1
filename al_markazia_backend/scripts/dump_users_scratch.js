const { PrismaClient } = require('@prisma/client');
const { decrypt } = require('../src/utils/crypto');
const prisma = new PrismaClient();

async function main() {
  console.log('--- Database Users Dump ---');
  try {
    const users = await prisma.user.findMany();
    console.log(`Total users in database: ${users.length}\n`);
    for (const u of users) {
      let decryptedEmail = 'Error decrypting';
      let decryptedName = 'Error decrypting';
      try {
        decryptedEmail = decrypt(u.email);
      } catch (e) {
        decryptedEmail = `[RAW] ${u.email}`;
      }
      try {
        decryptedName = u.name ? decrypt(u.name) : 'N/A';
      } catch (e) {
        decryptedName = `[RAW] ${u.name}`;
      }

      console.log(`User ID: ${u.id}`);
      console.log(`  UUID: ${u.uuid}`);
      console.log(`  Name: ${decryptedName}`);
      console.log(`  Email: ${decryptedEmail}`);
      console.log(`  Email Hash: ${u.emailHash}`);
      console.log(`  Role: ${u.role}`);
      console.log(`  Is Active: ${u.isActive}`);
      console.log(`  Failed Attempts: ${u.failedAttempts}`);
      console.log(`  Lock Until: ${u.lockUntil}`);
      console.log('---------------------------');
    }
  } catch (err) {
    console.error('Error querying users:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
