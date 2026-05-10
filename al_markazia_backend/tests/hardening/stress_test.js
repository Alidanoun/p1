const container = require('../../src/lib/container');
const prisma = container.prisma;
const logger = container.logger;

async function runTests() {
  console.log('🚀 [PHASE 6] Starting Final Hardening Stress Tests...\n');

  try {
    // 1. Concurrent Status Updates (Race Condition Test)
    await testConcurrentUpdates();

    // 2. Idempotency Test (Duplicate Requests)
    await testIdempotency();

    // 3. Financial Integrity Test
    await testFinancialIntegrity();

    // 4. Branch Isolation Test
    await testBranchIsolation();

    console.log('\n✅ [PHASE 6] All Hardening Tests Passed!');
  } catch (err) {
    console.error('\n❌ [PHASE 6] Test Failure:', err.message);
    process.exit(1);
  }
}

/**
 * 🏎️ Test 1: Concurrent Status Updates
 * Objective: Verify that optimistic locking prevents race conditions.
 */
async function testConcurrentUpdates() {
  console.log('--- Test 1: Concurrent Status Updates ---');
  
  // Create dummy order
  const order = await prisma.order.create({
    data: {
      orderNumber: `TEST-RACE-${Date.now()}`,
      status: 'pending',
      total: 100,
      branchId: 'BRANCH_1', // Assume exists or use a real ID
      customerName: 'Test Customer',
      version: 1
    }
  });

  console.log(`Created Order #${order.id} with Version 1`);

  // Simulate 3 concurrent updates to 'preparing'
  const updates = [
    container.contractGateway.execute(order.id, 'UPDATE_STATUS', { status: 'preparing', version: 1, idempotencyKey: 'i1' }, { id: 1, role: 'admin' }),
    container.contractGateway.execute(order.id, 'UPDATE_STATUS', { status: 'preparing', version: 1, idempotencyKey: 'i2' }, { id: 1, role: 'admin' }),
    container.contractGateway.execute(order.id, 'UPDATE_STATUS', { status: 'preparing', version: 1, idempotencyKey: 'i3' }, { id: 1, role: 'admin' })
  ];

  const results = await Promise.allSettled(updates);
  
  const successCount = results.filter(r => r.status === 'fulfilled').length;
  const failureCount = results.filter(r => r.status === 'rejected').length;

  console.log(`Success: ${successCount}, Failures: ${failureCount}`);

  if (successCount !== 1) {
    throw new Error(`Expected exactly 1 success for concurrent version 1 updates, got ${successCount}`);
  }
  
  console.log('✅ Race Condition Protection Verified.\n');
}

/**
 * 🔁 Test 2: Idempotency
 * Objective: Verify that same idempotency key returns same result without re-executing.
 */
async function testIdempotency() {
  console.log('--- Test 2: Idempotency ---');
  
  const order = await prisma.order.create({
    data: {
      orderNumber: `TEST-IDEM-${Date.now()}`,
      status: 'pending',
      total: 50,
      branchId: 'BRANCH_1'
    }
  });

  const key = `idem_${order.id}`;
  
  // First request
  const r1 = await container.contractGateway.execute(order.id, 'UPDATE_STATUS', { status: 'preparing', idempotencyKey: key }, { id: 1, role: 'admin' });
  
  // Second request (identical)
  const r2 = await container.contractGateway.execute(order.id, 'UPDATE_STATUS', { status: 'preparing', idempotencyKey: key }, { id: 1, role: 'admin' });

  if (r1.version !== r2.version) {
    throw new Error('Idempotent response version mismatch');
  }

  console.log('✅ Idempotency Verified (Authoritative Response Replayed).\n');
}

/**
 * 🛡️ Test 3: Branch Isolation
 * Objective: Verify that a manager cannot access another branch's order.
 */
async function testBranchIsolation() {
  console.log('--- Test 3: Branch Isolation ---');
  
  const otherBranchOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-ISO-${Date.now()}`,
      status: 'pending',
      total: 20,
      branchId: 'BRANCH_B'
    }
  });

  const managerA = { id: 101, role: 'BRANCH_MANAGER', branchId: 'BRANCH_A' };

  try {
    await container.contractGateway.execute(otherBranchOrder.id, 'UPDATE_STATUS', { status: 'preparing', idempotencyKey: 'iso_fail' }, managerA);
    throw new Error('Manager accessed unauthorized branch order!');
  } catch (err) {
    if (err.message === 'UNAUTHORIZED') {
      console.log('✅ Branch Isolation Verified (Access Blocked).\n');
    } else {
      throw err;
    }
  }
}

/**
 * 💰 Test 4: Financial Integrity
 * Objective: Verify that PricingService handles totals correctly.
 */
async function testFinancialIntegrity() {
  console.log('--- Test 4: Financial Integrity ---');
  
  const pricingService = require('../../src/services/pricingService');
  
  const items = [
    { unitPrice: 10.00, quantity: 2 }, // 20.00
    { unitPrice: 5.50, quantity: 1 }   // 5.50
  ];
  
  const totals = pricingService.calculateOrderTotals(items, 2.00, 1.50); // 20 + 5.5 + 2 - 1.5 = 26.00
  
  console.log('Calculated Totals:', totals);
  
  if (totals.total !== 26.00) {
    throw new Error(`Financial calculation mismatch! Expected 26.00, got ${totals.total}`);
  }

  console.log('✅ Financial Integrity Verified.\n');
}

runTests();
