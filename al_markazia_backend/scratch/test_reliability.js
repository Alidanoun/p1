const prisma = require('../src/lib/prisma');
const { performStatusUpdate } = require('../src/controllers/orderController');
const logger = require('../src/utils/logger');

// Need to initialize event system so subscribers are active
const eventSystem = require('../src/events/init');

async function runTest() {
  console.log('🚀 Starting SRE Reliability Test...');
  
  try {
    // 0. Initialize System
    // We mock socket ready for the test
    const socketModule = require('../src/socket');
    socketModule.init({ on: () => {}, emit: () => {} }); // Minimal mock
    await eventSystem.init();

    // 1. Pick a real order from DB
    const order = await prisma.order.findFirst({
        include: { customer: true }
    });

    if (!order) {
      console.error('❌ No orders found in DB to test with.');
      return;
    }

    console.log(`📦 Testing with Order #${order.orderNumber} (ID: ${order.id})`);

    // 2. Trigger Status Update
    const nextStatus = order.status === 'pending' ? 'preparing' : 'pending';
    console.log(`🔄 Updating status to: ${nextStatus}...`);
    
    await performStatusUpdate(order.id, nextStatus);

    console.log('⏳ Waiting 5 seconds for delivery engine...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 3. Verify DB Persistence & State Machine
    const notification = await prisma.notification.findFirst({
      where: { orderId: order.id },
      orderBy: { createdAt: 'desc' }
    });

    if (notification) {
      console.log('\n✅ TEST RESULTS:');
      console.log(`   - ID: ${notification.id}`);
      console.log(`   - Status: ${notification.status}`);
      console.log(`   - Socket Sent: ${notification.socketSent}`);
      console.log(`   - FCM Sent: ${notification.fcmSent}`);
      console.log(`   - Type: ${notification.type}`);
      console.log(`   - Created At: ${notification.createdAt}`);
      
      if (notification.status === 'SENT' || notification.status === 'PENDING') {
         console.log('\n🏁 VERDICT: PASS (State Machine correctly initialized)');
      } else {
         console.log('\n🏁 VERDICT: INVESTIGATE (Status is ' + notification.status + ')');
      }
    } else {
      console.error('❌ FAILED: No notification record found in DB.');
    }

  } catch (err) {
    console.error('💥 TEST CRASHED:', err.message);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

runTest();
