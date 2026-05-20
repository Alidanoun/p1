/**
 * 🔄 Data Migration: Notification.customerPhone → Notification.customerId
 * 
 * Purpose: Map existing customerPhone values to customerId FK references.
 * Run ONCE after schema update.
 * 
 * Usage: node prisma/migrations/migrate_notification_customer.js
 */

const { PrismaClient } = require('@prisma/client');

async function migrate() {
  const prisma = new PrismaClient();
  let mapped = 0;
  let notFound = 0;
  let alreadyMapped = 0;

  try {
    console.log('🔄 Starting Notification customerPhone → customerId migration...\n');

    const notifications = await prisma.notification.findMany({
      where: {
        customerId: null,
        customerPhone: { not: null }
      },
      select: {
        id: true,
        customerPhone: true
      }
    });

    console.log(`📋 Found ${notifications.length} notifications with customerPhone but no customerId\n`);

    for (const notif of notifications) {
      const customer = await prisma.customer.findFirst({
        where: { phone: notif.customerPhone },
        select: { id: true }
      });

      if (customer) {
        await prisma.notification.update({
          where: { id: notif.id },
          data: { customerId: customer.id }
        });
        mapped++;
      } else {
        notFound++;
      }
    }

    const alreadyMappedCount = await prisma.notification.count({
      where: {
        customerId: { not: null }
      }
    });

    console.log('✅ Migration Summary:');
    console.log(`   📌 Total processed: ${notifications.length}`);
    console.log(`   ✅ Mapped to customer: ${mapped}`);
    console.log(`   ❌ Phone not found in DB: ${notFound}`);
    console.log(`   📊 Already had customerId: ${alreadyMappedCount}`);

    if (notFound > 0) {
      console.log(`\n⚠️  ${notFound} notification(s) have customerPhone that doesn't match any customer.`);
      console.log('   These may be guest orders or deleted customers. customerPhone kept for reference.');
    }

  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

migrate();
