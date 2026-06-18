// Direct test: call the gateway from inside the running server
// Run with: node --require ./src/lib/prisma.js test_gateway_direct.js

async function main() {
  // Boot the container
  const container = require('./src/lib/container');
  
  // Get order #8 info
  const order = await container.prisma.order.findUnique({
    where: { id: 8 },
    select: { id: true, status: true, version: true, branchId: true }
  });
  
  console.log('Order #8:', JSON.stringify(order));
  
  if (!order) {
    console.log('Order not found');
    process.exit(1);
  }
  
  // Simulate what the controller does
  const { randomUUID } = require('crypto');
  const idempotencyKey = randomUUID();
  
  const context = {
    status: 'in_route', // next valid status from 'ready'
    version: order.version,
    idempotencyKey
  };
  
  const actor = { id: 1, role: 'admin' };
  
  console.log('\n=== Testing Gateway Execute ===');
  console.log('Context:', JSON.stringify(context));
  console.log('Actor:', JSON.stringify(actor));
  
  try {
    // Step 1: Test schema
    console.log('\n--- Step 1: Schema validation ---');
    const { v1 } = require('./src/contracts/order.contract.v1');
    try {
      v1.TransitionStatusSchema.parse({ ...context, orderId: order.id });
      console.log('Schema: ✅ PASSED');
    } catch(e) {
      console.log('Schema: ❌ FAILED:', JSON.stringify(e.errors));
    }
    
    // Step 2: Test state machine
    console.log('\n--- Step 2: State machine ---');
    try {
      container.orderStateMachine.validate(order.status, context.status, actor);
      console.log('State Machine: ✅ PASSED');
    } catch(e) {
      console.log('State Machine: ❌ FAILED:', e.message);
    }
    
    // Step 3: Test health
    console.log('\n--- Step 3: System health ---');
    const health = await container.systemControlPlane.getHealthStatus();
    console.log('Health:', health.status);
    if (health.status === 'PROTECTED_MODE') {
      console.log('Kill switch:', JSON.stringify(health.killSwitch));
    }
    
    // Step 4: Test full gateway
    console.log('\n--- Step 4: Full gateway execute ---');
    const result = await container.contractGateway.execute(
      order.id,
      'UPDATE_STATUS', 
      context, 
      actor
    );
    console.log('Result: ✅ SUCCESS');
    console.log('New status:', result?.status);
    
  } catch (error) {
    console.log('\n❌ FULL ERROR:', error.message);
    console.log('Stack:', error.stack);
  } finally {
    await container.prisma.$disconnect();
    // Give time for async cleanup
    setTimeout(() => process.exit(0), 2000);
  }
}

main();
