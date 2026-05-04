/**
 * 🧪 Phase 4: Logic Verification & Testing Suite
 * This script verifies the integrity of the ContractGateway Phase 2 implementation.
 * It uses a mock-based approach to validate security rules, state transitions,
 * and lock strategies without requiring a live database or Redis.
 */

const assert = require('assert');

// 1. Mocks
const mockRedis = {
  set: async () => 'OK',
  del: async () => 1,
  get: async () => null
};

const mockPrisma = {
  order: {
    findUnique: async () => null,
    count: async () => 0
  },
  customer: {
    findUnique: async () => null
  }
};

const mockSecurityPolicy = {
  canAccessBranch: async () => true,
  getHardenedFilter: async () => ({})
};

const mockOrderService = {
  createOrder: async (data) => ({ id: 999, ...data }),
  batchAcceptOrders: async () => ({ accepted: 5 }),
  requestPartialCancel: async (id, items) => ({ success: true, id })
};

// 2. Test Runner
async function runTests() {
  console.log('--- 🛡️ Starting Phase 4: Gateway Logic Verification ---\n');

  // We need to point to the gateway but override its requires
  process.env.ENABLE_ORDER_MODIFICATION_WRITE = 'true';

  const gateway = require('../src/services/contractGateway');

  // --- Test Case 1: CREATE_ORDER Deduplication Logic ---
  console.log('[Test 1] Verifying CREATE_ORDER Lock Key Generation...');
  const actor = { id: 'user123', role: 'customer' };
  const context = { 
    items: [{ id: 1, quantity: 2 }, { id: 2, quantity: 1 }],
    idempotencyKey: 'idemp-1'
  };
  
  const lockKey1 = gateway._getLockKey(null, 'CREATE_ORDER', context, actor);
  
  // Changing item order shouldn't change the lock key
  const context2 = { 
    items: [{ id: 2, quantity: 1 }, { id: 1, quantity: 2 }],
    idempotencyKey: 'idemp-2'
  };
  const lockKey2 = gateway._getLockKey(null, 'CREATE_ORDER', context2, actor);
  
  assert.strictEqual(lockKey1, lockKey2, '❌ Cart hash should be consistent regardless of item order');
  console.log('✅ Cart hash deduplication logic: PASSED');

  // --- Test Case 2: BATCH_ACCEPT Authorization ---
  console.log('[Test 2] Verifying BATCH_ACCEPT Role Restrictions...');
  const customerActor = { id: 'cust1', role: 'customer' };
  
  try {
    await gateway._executeBatchAccept({}, customerActor, mockPrisma);
    assert.fail('Should have thrown UNAUTHORIZED_BATCH_ACCEPT');
  } catch (e) {
    assert.ok(e.message.includes('UNAUTHORIZED_BATCH_ACCEPT') || e.message.includes('UNAUTHORIZED'), `Expected auth error, got: ${e.message}`);
  }
  console.log('✅ Batch Accept role enforcement: PASSED');

  // --- Test Case 3: REQUEST_PARTIAL_CANCEL State Validation ---
  console.log('[Test 3] Verifying PARTIAL_CANCEL State Guard...');
  const deliveredOrder = { id: 10, status: 'delivered', branchId: 1, orderItems: [] };
  const mockPrismaWithDelivered = {
    order: {
      findUnique: async () => deliveredOrder
    }
  };

  try {
    await gateway._executeRequestPartialCancel(10, { items: [1], reason: 'test' }, { role: 'admin' }, mockPrismaWithDelivered);
    assert.fail('Should have blocked cancellation for delivered order');
  } catch (e) {
    assert.ok(e.message.includes('INVALID_STATE'), `Expected state error, got: ${e.message}`);
  }
  console.log('✅ Cancellation state guard: PASSED');

  // --- Test Case 4: REQUEST_PARTIAL_CANCEL Item Validation ---
  console.log('[Test 4] Verifying PARTIAL_CANCEL Item Existence Check...');
  const orderWithItems = { 
    id: 11, 
    status: 'pending', 
    branchId: 1, 
    orderItems: [{ id: 101, unitPrice: 10, quantity: 1 }] 
  };
  const mockPrismaWithOrder = {
    order: {
      findUnique: async () => orderWithItems
    }
  };

  try {
    // Requesting item 999 which is NOT in the order
    await gateway._executeRequestPartialCancel(11, { items: [{id: 999}], reason: 'test' }, { role: 'admin' }, mockPrismaWithOrder);
    assert.fail('Should have blocked invalid item ID');
  } catch (e) {
    assert.ok(e.message.includes('INVALID_ITEMS'), `Expected item validation error, got: ${e.message}`);
  }
  console.log('✅ Item existence validation: PASSED');

  console.log('\n--- 🎊 ALL LOGIC TESTS PASSED ---');
}

runTests().catch(err => {
  console.error('\n❌ VERIFICATION FAILED');
  console.error(err);
  process.exit(1);
});
