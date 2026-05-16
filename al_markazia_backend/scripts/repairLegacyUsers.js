require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { encrypt, decrypt, hashBlind } = require('../src/utils/crypto');
const prisma = new PrismaClient();

/**
 * 🛠️ Legacy User Data Repair Script
 * Migrates plain text emails/names to encrypted format and generates missing emailHash.
 */
async function repair() {
  console.log('\n🚀 Starting Legacy User Repair Process...');
  
  try {
    const users = await prisma.user.findMany();
    const customers = await prisma.customer.findMany();
    
    console.log(`📊 Found ${users.length} users and ${customers.length} customers.`);

    let repairedUsers = 0;
    let skippedUsers = 0;
    let errors = 0;

    const processRecord = async (record, table) => {
      try {
        const plainEmail = decrypt(record.email); // Safe decrypt returns plain if not encrypted
        const cleanEmail = plainEmail.toLowerCase().trim();
        const expectedHash = hashBlind(cleanEmail);
        const encryptedEmail = encrypt(cleanEmail);
        
        let needsUpdate = false;
        const updateData = {};

        // 1. Check Email Encryption
        if (record.email !== encryptedEmail) {
          updateData.email = encryptedEmail;
          needsUpdate = true;
        }

        // 2. Check Email Hash
        if (record.emailHash !== expectedHash) {
          updateData.emailHash = expectedHash;
          needsUpdate = true;
        }

        // 3. Check Name Encryption (if exists and is plain)
        if (record.name) {
          const plainName = decrypt(record.name);
          const encryptedName = encrypt(plainName);
          if (record.name !== encryptedName) {
            updateData.name = encryptedName;
            needsUpdate = true;
          }
        }

        if (needsUpdate) {
          await prisma[table].update({
            where: { id: record.id },
            data: updateData
          });
          repairedUsers++;
        } else {
          skippedUsers++;
        }
      } catch (err) {
        console.error(`❌ Failed to repair ${table} ID: ${record.id}`, err.message);
        errors++;
      }
    };

    console.log('\n🔧 Repairing Users...');
    for (const user of users) {
      await processRecord(user, 'user');
    }

    console.log('🔧 Repairing Customers...');
    for (const customer of customers) {
      await processRecord(customer, 'customer');
    }

    console.log('\n' + '='.repeat(30));
    console.log('✅ REPAIR SUMMARY');
    console.log('='.repeat(30));
    console.log(`✨ Repaired: ${repairedUsers}`);
    console.log(`⏩ Skipped:  ${skippedUsers}`);
    console.log(`❌ Errors:   ${errors}`);
    console.log('='.repeat(30) + '\n');

  } catch (err) {
    console.error('💥 Fatal error during repair:', err);
  } finally {
    await prisma.$disconnect();
  }
}

repair();
