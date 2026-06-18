// Diagnostic: Test order status change through the full stack
const prisma = require('./src/lib/prisma');
const logger = require('./src/utils/logger');

async function diagnose() {
  try {
    // 1. Find an order with status 'pending' or any non-terminal status
    const orders = await prisma.order.findMany({
      where: { isDeleted: false },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, status: true, version: true, orderNumber: true, branchId: true, customerId: true }
    });
    console.log('=== LATEST ORDERS ===');
    orders.forEach(o => console.log(`Order #${o.id} (${o.orderNumber}): status=${o.status}, version=${o.version}, branchId=${o.branchId}`));

    // 2. Try to validate the state machine for order #8 specifically  
    const order8 = await prisma.order.findUnique({
      where: { id: 8 },
      select: { id: true, status: true, version: true, orderNumber: true, branchId: true }
    });
    console.log('\n=== ORDER #8 ===');
    console.log(order8 ? JSON.stringify(order8) : 'NOT FOUND');

    // 3. Test the domain state machine
    const { OrderStateMachine } = require('./src/domain/orderStateMachine');
    const sm = new OrderStateMachine(logger);
    
    if (order8) {
      const testStatuses = ['confirmed', 'preparing', 'ready', 'in_route', 'delivered', 'cancelled'];
      console.log('\n=== STATE MACHINE VALIDATION (from ' + order8.status + ') ===');
      for (const target of testStatuses) {
        try {
          const actor = { id: 1, role: 'admin' };
          sm.validate(order8.status, target, actor);
          console.log(`  ${order8.status} -> ${target}: ✅ ALLOWED`);
        } catch (e) {
          console.log(`  ${order8.status} -> ${target}: ❌ ${e.message}`);
        }
      }
    }

    // 4. Test the contract validation
    console.log('\n=== CONTRACT SCHEMA VALIDATION ===');
    try {
      const { v1 } = require('./src/contracts/order.contract.v1');
      console.log('TransitionStatusSchema exists:', !!v1.TransitionStatusSchema);
      const testData = { status: 'confirmed', orderId: 8 };
      v1.TransitionStatusSchema.parse(testData);
      console.log('Schema validation passed for:', JSON.stringify(testData));
    } catch(e) {
      console.log('Schema validation FAILED:', e.message);
      if (e.errors) console.log('Schema errors:', JSON.stringify(e.errors));
    }

    // 5. Test container services initialization
    console.log('\n=== CONTAINER SERVICES ===');
    const container = require('./src/lib/container');
    const services = ['systemControlPlane', 'securityPolicyService', 'idempotencyService', 'circuitBreakerService', 'orderStateMachine', 'orderLifecycleOrchestrator'];
    for (const svc of services) {
      try {
        const instance = container[svc];
        console.log(`  ${svc}: ✅ (${typeof instance})`);
      } catch(e) {
        console.log(`  ${svc}: ❌ ${e.message}`);
      }
    }

    // 6. Test the full gateway execute for UPDATE_STATUS
    console.log('\n=== FULL GATEWAY TEST (DRY RUN) ===');
    if (order8 && order8.status !== 'delivered' && order8.status !== 'cancelled') {
      try {
        // Find the next valid status
        const { OrderStateMachine: SM } = require('./src/domain/orderStateMachine');
        const smTest = new SM(logger);
        const transitions = require('./src/domain/orderStateMachine');
        
        // Determine what the next valid status would be
        let nextStatus = null;
        const statusMap = {
          'pending': 'confirmed',
          'confirmed': 'preparing',
          'preparing': 'ready',
          'ready': 'in_route',
          'in_route': 'delivered'
        };
        nextStatus = statusMap[order8.status];
        
        if (nextStatus) {
          console.log(`  Would transition: ${order8.status} -> ${nextStatus}`);
          
          // Test the health check
          const health = await container.systemControlPlane.getHealthStatus();
          console.log(`  System Health: ${JSON.stringify(health.status)}`);
          
          // Test circuit breaker
          const cbOpen = await container.circuitBreakerService.isOpen('ORDER_OPERATIONS');
          console.log(`  Circuit Breaker Open: ${cbOpen}`);
          
          // Test security policy
          const actor = { id: 1, role: 'admin' };
          const hasAccess = await container.securityPolicyService.canAccessBranch(actor, order8.branchId, 'write');
          console.log(`  Branch Access: ${hasAccess}`);
          
          // Test Redis lock
          const lockKey = `lock:order:${order8.id}:1`;
          const lockResult = await container.redis.set(lockKey, 'test', 'NX', 'EX', 5);
          console.log(`  Redis Lock Test: ${lockResult}`);
          await container.redis.del(lockKey);
          
          console.log('  All pre-checks PASSED ✅');
        }
      } catch(e) {
        console.log(`  GATEWAY PRE-CHECK FAILED: ❌ ${e.message}`);
        console.log(`  Stack: ${e.stack}`);
      }
    }

  } catch (err) {
    console.error('DIAGNOSTIC FATAL ERROR:', err.message);
    console.error(err.stack);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

diagnose();
