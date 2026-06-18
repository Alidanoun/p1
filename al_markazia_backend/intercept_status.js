// Intercept and log the exact error from order status changes
// This patches the error handler to log full details

const originalModule = require('./src/controllers/orderController');
const origHandler = originalModule.updateOrderStatus;

// Monkey-patch to capture full error
originalModule.updateOrderStatus = async (req, res) => {
  console.log('\n=== INTERCEPTED STATUS CHANGE REQUEST ===');
  console.log('Order ID:', req.params.id);
  console.log('Body:', JSON.stringify(req.body));
  console.log('Headers idempotency-key:', req.headers['idempotency-key']);
  console.log('User:', JSON.stringify({ id: req.user?.id, role: req.user?.role }));
  
  try {
    const orderId = parseInt(req.params.id);
    const { status, version } = req.body;
    const idempotencyKey = req.headers['idempotency-key'];
    
    console.log('Parsed values:', { orderId, status, version, idempotencyKey });
    console.log('Types:', { 
      orderId: typeof orderId, 
      status: typeof status, 
      version: typeof version, 
      idempotencyKey: typeof idempotencyKey 
    });
    
    // Test schema validation separately
    const { v1 } = require('./src/contracts/order.contract.v1');
    const schemaInput = { status, version, idempotencyKey, orderId };
    console.log('Schema input:', JSON.stringify(schemaInput));
    try {
      v1.TransitionStatusSchema.parse(schemaInput);
      console.log('Schema: ✅ PASSED');
    } catch(e) {
      console.log('Schema: ❌ FAILED');
      console.log('Schema errors:', JSON.stringify(e.errors));
    }
    
    // Now call the real handler
    return await origHandler(req, res);
  } catch(e) {
    console.log('FULL ERROR:', e.message);
    console.log('STACK:', e.stack);
    throw e;
  }
};

console.log('✅ Order status change interceptor installed');
