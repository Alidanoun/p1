// Test: Simulate exact frontend API call for order status change
const http = require('http');

// Simulate login first to get a token
function makeRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch(e) {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test() {
  // Step 1: Login to get auth token
  console.log('=== STEP 1: Login ===');
  const loginResult = await makeRequest({
    hostname: 'localhost',
    port: 5000,
    path: '/api/v1/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    email: 'admin@almarkazia.com',
    password: 'Admin@123456'
  });
  console.log('Login status:', loginResult.status);
  
  if (loginResult.status !== 200) {
    console.log('Login response:', JSON.stringify(loginResult.body).substring(0, 500));
    process.exit(1);
  }
  
  const token = loginResult.body.token || loginResult.body.data?.token || loginResult.body.accessToken || loginResult.body.data?.accessToken;
  console.log('Token:', token ? token.substring(0, 30) + '...' : 'NOT FOUND');
  console.log('Full login response keys:', Object.keys(loginResult.body));
  if (loginResult.body.data) console.log('data keys:', Object.keys(loginResult.body.data));

  if (!token) {
    console.log('Full login response:', JSON.stringify(loginResult.body).substring(0, 1000));
    process.exit(1);
  }

  // Step 2: Get order #8 current state
  console.log('\n=== STEP 2: Get Order #8 ===');
  const orderResult = await makeRequest({
    hostname: 'localhost',
    port: 5000,
    path: '/api/v1/orders/8',
    method: 'GET',
    headers: { 
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  console.log('Order status:', orderResult.status);
  if (orderResult.status === 200) {
    const order = orderResult.body.data || orderResult.body;
    console.log('Order #8 current status:', order.status);
    console.log('Order #8 version:', order.version);
  } else {
    console.log('Order response:', JSON.stringify(orderResult.body).substring(0, 500));
  }

  // Step 3: Try to change status (exactly like frontend)
  console.log('\n=== STEP 3: Change Status (like frontend) ===');
  const uuid = require('crypto').randomUUID();
  const statusResult = await makeRequest({
    hostname: 'localhost',
    port: 5000,
    path: '/api/v1/orders/8/status',
    method: 'PATCH',
    headers: { 
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'idempotency-key': uuid
    }
  }, {
    status: 'in_route',
    version: 3
  });
  console.log('Status change result:', statusResult.status);
  console.log('Response body:', JSON.stringify(statusResult.body).substring(0, 1000));
}

test().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
