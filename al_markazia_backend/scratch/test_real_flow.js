const orderService = require('../src/services/orderService');
const eventBus = require('../src/events/eventBus');
const notificationService = require('../src/services/notificationService');

async function testRealFlow() {
  // We need to initialize the notification service to register listeners
  notificationService.init();

  console.log('🔄 Triggering status update for Order #1...');
  try {
    // This should trigger the eventBus -> notificationService -> Socket.emit
    await orderService.updateOrderStatus(1, 'preparing');
    console.log('✅ Status updated. Check if app received socket update.');
  } catch (err) {
    console.error('❌ Flow failed:', err.message);
  }
  
  // Keep alive for a bit to ensure event processing
  setTimeout(() => process.exit(0), 2000);
}

testRealFlow();
