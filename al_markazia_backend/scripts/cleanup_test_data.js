const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanup() {
  console.log('🧹 Starting Professional Data Cleanup...');
  
  try {
    // 1. Identify simulation customers
    const simCustomers = await prisma.customer.findMany({
      where: {
        OR: [
          { name: { startsWith: 'SimUser_' } },
          { name: { startsWith: 'SimUser' } }
        ]
      },
      select: { id: true, phone: true }
    });

    const customerIds = simCustomers.map(c => c.id);
    const customerPhones = simCustomers.map(c => c.phone);

    console.log(`🔍 Found ${customerIds.length} simulation customers.`);

    if (customerIds.length === 0) {
      console.log('✅ No simulation data found. System is already clean.');
      return;
    }

    // 2. Delete related records in order
    // Note: Some have FK constraints, so we delete from bottom up

    // A. Audit Logs
    const auditLogs = await prisma.orderAuditLog.deleteMany({
      where: { order: { customerId: { in: customerIds } } }
    });
    console.log(`🗑️ Deleted ${auditLogs.count} Order Audit Logs.`);

    // B. Order Items
    const orderItems = await prisma.orderItem.deleteMany({
      where: { order: { customerId: { in: customerIds } } }
    });
    console.log(`🗑️ Deleted ${orderItems.count} Order Items.`);

    // C. Payments
    const payments = await prisma.payment.deleteMany({
      where: { order: { customerId: { in: customerIds } } }
    });
    console.log(`🗑️ Deleted ${payments.count} Payments.`);

    // D. Cancellations
    const cancellations = await prisma.orderCancellation.deleteMany({
      where: { order: { customerId: { in: customerIds } } }
    });
    console.log(`🗑️ Deleted ${cancellations.count} Cancellation Requests.`);

    // E. Orders
    const orders = await prisma.order.deleteMany({
      where: { customerId: { in: customerIds } }
    });
    console.log(`🗑️ Deleted ${orders.count} Orders.`);

    // F. Notifications
    const notifications = await prisma.notification.deleteMany({
      where: { 
        OR: [
          { customerPhone: { in: customerPhones } },
          { message: { contains: 'SimUser' } }
        ]
      }
    });
    console.log(`🗑️ Deleted ${notifications.count} Notifications.`);

    // G. Idempotency Records (Simulation keys)
    const idempotency = await prisma.idempotencyRecord.deleteMany({
      where: { key: { contains: 'load-test' } }
    });
    console.log(`🗑️ Deleted ${idempotency.count} Idempotency Records.`);

    // H. Customer Audit Logs
    const customerLogs = await prisma.customerAuditLog.deleteMany({
       where: { customerId: { in: customerIds } }
    });
    console.log(`🗑️ Deleted ${customerLogs.count} Customer Audit Logs.`);

    // I. Finally, Customers
    const deletedCustomers = await prisma.customer.deleteMany({
      where: { id: { in: customerIds } }
    });
    console.log(`🗑️ Deleted ${deletedCustomers.count} Customers.`);

    console.log('\n✨ System Cleanup Completed Successfully.');

  } catch (error) {
    console.error('❌ Cleanup Failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

cleanup();
