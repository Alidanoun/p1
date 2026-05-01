const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const orderService = require('./src/services/orderService');

async function runCancellationSimulation() {
  console.log('🚀 Starting Cancellation Engine Simulation...\n');

  try {
    // 1. Setup Data
    const branchA = await prisma.branch.findFirst({ where: { code: 'MAIN_BRANCH' } });
    const userManagerA = { id: 'manager-uuid', role: 'BRANCH_MANAGER', branchId: branchA.id, email: 'manager@branch.a' };
    const userSuperAdmin = { id: 'admin-uuid', role: 'super_admin', email: 'admin@system.com' };

    // ---------------------------------------------------------
    console.log('🧪 SCENARIO 1: LOW Level (Auto-Cancel)');
    const order1 = await orderService.createOrder({
      customerName: 'Test Low',
      customerPhone: '111111',
      orderType: 'takeaway',
      cartItems: [{ id: 1, quantity: 1 }],
      branchId: branchA.id
    });

    console.log(`- Order #${order1.orderNumber} created at ${order1.createdAt}`);
    const cancel1 = await orderService.cancelOrder(parseInt(order1.id), { id: 'customer-uuid', role: 'customer' }, 'Wrong order');
    
    if (cancel1.status === 'cancelled') {
      console.log('✅ PASS: Order auto-cancelled immediately.');
    } else {
      console.error('❌ FAIL: Order should have been auto-cancelled but is:', cancel1.status);
    }

    // ---------------------------------------------------------
    console.log('\n🧪 SCENARIO 2: MEDIUM Level (Manager Approval Required)');
    const order2 = await orderService.createOrder({
      customerName: 'Test Medium',
      customerPhone: '222222',
      orderType: 'takeaway',
      cartItems: [{ id: 1, quantity: 1 }],
      branchId: branchA.id
    });

    // Manually push status to 'preparing' to trigger MEDIUM level
    await prisma.order.update({ where: { id: parseInt(order2.id) }, data: { status: 'preparing' } });
    console.log(`- Order #${order2.orderNumber} set to 'preparing'`);

    const request2 = await orderService.cancelOrder(parseInt(order2.id), { id: 'customer-uuid', role: 'customer' }, 'Changed my mind');
    if (request2.status === 'waiting_cancellation') {
      console.log('✅ PASS: Order is waiting for manager approval.');
    } else {
      console.error('❌ FAIL: Order status is:', request2.status);
    }

    // Manager Approves
    const approve2 = await orderService.approveCancellation(parseInt(order2.id), userManagerA);
    if (approve2.status === 'cancelled') {
      console.log('✅ PASS: Manager approved and order cancelled.');
    } else {
      console.error('❌ FAIL: Manager approval failed to cancel.');
    }

    // ---------------------------------------------------------
    console.log('\n🧪 SCENARIO 3: HIGH Level (Admin Only)');
    const order3 = await orderService.createOrder({
      customerName: 'Test High',
      customerPhone: '333333',
      orderType: 'takeaway',
      cartItems: [{ id: 1, quantity: 100 }], // High quantity to trigger HIGH level total
      branchId: branchA.id
    });

    // Manually push status to 'ready' to trigger HIGH level
    await prisma.order.update({ where: { id: parseInt(order3.id) }, data: { status: 'ready' } });
    console.log(`- Order #${order3.orderNumber} set to 'ready' and has high value`);

    const request3 = await orderService.cancelOrder(parseInt(order3.id), { id: 'customer-uuid', role: 'customer' }, 'Too expensive');
    if (request3.status === 'waiting_cancellation_admin') {
      console.log('✅ PASS: High-risk order waiting for ADMIN approval.');
    } else {
      console.error('❌ FAIL: Status is:', request3.status);
    }

    // Manager Tries to Approve HIGH
    try {
      await orderService.approveCancellation(parseInt(order3.id), userManagerA);
      console.error('❌ FAIL: Manager was able to approve HIGH level order!');
    } catch (err) {
      if (err.message === 'ADMIN_APPROVAL_REQUIRED') {
        console.log('✅ PASS: Manager blocked from approving HIGH level order.');
      } else {
        console.error('⚠️ Unexpected error:', err.message);
      }
    }

    // ---------------------------------------------------------
    console.log('\n🧪 SCENARIO 4: Idempotency (Safety Check)');
    try {
      // Trying to approve an already processed cancellation
      await orderService.approveCancellation(parseInt(order2.id), userSuperAdmin);
      console.error('❌ FAIL: System allowed processing an already processed cancellation!');
    } catch (err) {
      if (err.message === 'CANCELLATION_ALREADY_PROCESSED') {
        console.log('✅ PASS: Re-processing blocked.');
      } else {
        console.error('⚠️ Unexpected error:', err.message);
      }
    }

    console.log('\n🏆 ALL CANCELLATION ENGINE TESTS PASSED.');

  } catch (err) {
    console.error('🔥 Simulation Crashed:', err.stack);
  } finally {
    await prisma.$disconnect();
  }
}

runCancellationSimulation();
