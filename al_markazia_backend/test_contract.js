// Test script: validates the TransitionStatusSchema with realistic data
const { v1 } = require('./src/contracts/order.contract.v1');

console.log('=== Testing TransitionStatusSchema ===');

// Test 1: What the frontend sends
const testData = { orderId: 7, status: 'confirmed', idempotencyKey: '12345678-abcd-efgh', version: 1 };
console.log('Input:', JSON.stringify(testData));

try {
  v1.TransitionStatusSchema.parse(testData);
  console.log('Result: PASS');
} catch(e) {
  console.log('Result: FAIL');
  console.log('Errors:', JSON.stringify(e.errors, null, 2));
}

// Test 2: What the gateway actually sends to _validateContract
// From contractGateway.js line 139: v1.TransitionStatusSchema.parse({ ...context, orderId });
// context = { status, version, idempotencyKey } from orderController
// orderId comes from parseInt(req.params.id)
const gatewayData = { status: 'confirmed', version: 1, idempotencyKey: '12345678-abcd-efgh', orderId: 7 };
console.log('\n=== Testing what Gateway sends ===');
console.log('Input:', JSON.stringify(gatewayData));

try {
  v1.TransitionStatusSchema.parse(gatewayData);
  console.log('Result: PASS');
} catch(e) {
  console.log('Result: FAIL');
  console.log('Errors:', JSON.stringify(e.errors, null, 2));
}
