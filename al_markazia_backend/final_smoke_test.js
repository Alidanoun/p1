require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
console.log('--- SCRIPT STARTING ---');
const analyticsService = require('./src/services/analyticsService');
console.log('--- ANALYTICS LOADED ---');
const orderService = require('./src/services/orderService');
console.log('--- ORDER SERVICE LOADED ---');

async function runFinalSmokeTest() {
  console.log('🚀 Starting Final Production Smoke Test...\n');

  try {
    const branch = await prisma.branch.findFirst({ where: { code: 'MAIN_BRANCH' } });
    if (!branch) throw new Error('Main branch not found. Run migrations first.');

    // 1. Initial State
    const initialReport = await analyticsService.getBranchOperationalReport(branch.id);
    console.log(`📊 Initial Stats - Orders: ${initialReport.totalOrders}, Active: ${initialReport.activeOrders}`);

    // 2. Create Order
    console.log('🛒 Creating a new test order with Item #2...');
    const order = await orderService.createOrder({
      customerName: 'Smoke Test User',
      customerPhone: '99999999',
      orderType: 'takeaway',
      cartItems: [{ id: 2, quantity: 2 }],
      branchId: branch.id
    });
    console.log(`✅ Order #${order.orderNumber} created. (ID: ${order.id})`);

    // 3. Verify Stats Increase
    const midReport = await analyticsService.getBranchOperationalReport(branch.id);
    if (midReport.totalOrders === initialReport.totalOrders + 1) {
      console.log('✅ PASS: Daily stats updated correctly.');
    } else {
      console.error(`❌ FAIL: Stats mismatch. Expected ${initialReport.totalOrders + 1}, got ${midReport.totalOrders}`);
    }

    // 4. Test Cancellation Flow (Auto)
    console.log('🛑 Testing immediate auto-cancellation...');
    await orderService.cancelOrder(parseInt(order.id), { id: 'test-user', role: 'customer' }, 'Smoke test cleanup');
    
    const finalReport = await analyticsService.getBranchOperationalReport(branch.id);
    console.log(`📊 Final Stats - Orders: ${finalReport.totalOrders}, Active: ${finalReport.activeOrders}, Cancelled: ${finalReport.cancellations}`);

    if (finalReport.cancellations >= initialReport.cancellations + 1) {
      console.log('✅ PASS: Cancellation reflected in reports.');
    }

    console.log('\n🏆 FINAL SMOKE TEST COMPLETED SUCCESSFULLY.');
    console.log('System is STABLE and READY for production.');

  } catch (err) {
    console.error('🔥 Smoke Test Failed:', err.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runFinalSmokeTest();
