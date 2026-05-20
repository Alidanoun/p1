/**
 * 🔒 Data Migration: Encrypt existing plain-text customerPhone/customerName in Order table
 * 
 * Run ONCE after deploying encryption support.
 * Usage: node scripts/encrypt_existing_orders.js
 */

const prisma = require('../src/lib/prisma');
const { encrypt } = require('../src/utils/crypto');

async function migrate() {
  let encrypted = 0;
  let skipped = 0;
  let failed = 0;

  try {
    console.log('🔄 Starting Order customerPhone/customerName encryption migration...\n');

    const orders = await prisma.order.findMany({
      where: {
        isDeleted: false
      },
      select: {
        id: true,
        customerName: true,
        customerPhone: true
      }
    });

    console.log(`📋 Found ${orders.length} orders to process\n`);

    for (const order of orders) {
      const needsEncrypt = 
        (order.customerName && !order.customerName.includes(':')) ||
        (order.customerPhone && !order.customerPhone.includes(':'));

      if (!needsEncrypt) {
        skipped++;
        continue;
      }

      try {
        const updateData = {};
        if (order.customerName && !order.customerName.includes(':')) {
          updateData.customerName = encrypt(order.customerName);
        }
        if (order.customerPhone && !order.customerPhone.includes(':')) {
          updateData.customerPhone = encrypt(order.customerPhone);
        }

        if (Object.keys(updateData).length > 0) {
          await prisma.order.update({
            where: { id: order.id },
            data: updateData
          });
          encrypted++;
        }
      } catch (err) {
        failed++;
        console.error(`❌ Failed to encrypt order ${order.id}:`, err.message);
      }
    }

    console.log('✅ Migration Summary:');
    console.log(`   📌 Total processed: ${orders.length}`);
    console.log(`   ✅ Encrypted: ${encrypted}`);
    console.log(`   ⏭️ Already encrypted/skipped: ${skipped}`);
    console.log(`   ❌ Failed: ${failed}`);

  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

migrate();
