const http = require('http');

/**
 * 🛰️ Comprehensive System Verification (Node.js version)
 * Purpose: Run the full lifecycle test without k6 dependency.
 */

const BASE_URL = 'http://localhost:5000';
const TEST_EMAIL = `verify_user_${Date.now()}@example.com`;
const TEST_PASSWORD = 'Password123!';

async function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  console.log('--- 🚀 Starting Comprehensive System Verification ---\n');

  try {
    // 1. Phase 1 Registration
    console.log(`[1/6] Registering ${TEST_EMAIL}...`);
    const regRes = await request('POST', '/auth/register', {
      name: 'System Verifier',
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      phone: '079' + Math.floor(Math.random() * 9000000 + 1000000)
    });

    if (regRes.status !== 200) {
      console.log('Error Body:', JSON.stringify(regRes.data));
      throw new Error(`Registration Phase 1 failed: ${regRes.status}`);
    }
    console.log('✅ Phase 1 (OTP Sent) Success');

    // 2. Phase 2 Verification
    console.log('[2/6] Verifying OTP (Code: 123456)...');
    const verifyRes = await request('POST', '/auth/verify-registration', {
      email: TEST_EMAIL,
      code: '123456'
    });

    if (verifyRes.status !== 200) {
      console.log('Error Body:', JSON.stringify(verifyRes.data));
      throw new Error(`Registration Phase 2 failed: ${verifyRes.status}`);
    }
    const userToken = verifyRes.data.data.accessToken;
    console.log(`Token received: ${userToken.substring(0, 20)}...`);
    const userHeaders = { 'Authorization': `Bearer ${userToken}` };
    console.log('✅ Phase 2 (Account Active) Success');

    // 3. Place Order
    console.log('[3/6] Placing test order...');
    const orderRes = await request('POST', '/orders', {
      customerName: 'System Verifier',
      orderType: 'delivery',
      paymentMethod: 'cash',
      address: 'Verifier St 1',
      branch: 'فرع شارع المدينة',
      cartItems: [{ id: 2, quantity: 2, unitPrice: 7.0, name: 'Margherita Pizza' }],
      deliveryFee: 2.0
    }, userHeaders);

    if (orderRes.status !== 201 && orderRes.status !== 200) {
      console.log('Error Body:', JSON.stringify(orderRes.data));
      throw new Error(`Order failed: ${orderRes.status}`);
    }
    const orderId = orderRes.data.data?.id || orderRes.data.id;
    const orderNumber = orderRes.data.data?.orderNumber || orderRes.data.orderNumber;
    console.log(`✅ Order Created: #${orderNumber}`);

    // 4. Admin Delivery
    console.log('[4/6] Admin login & delivering order...');
    const adminLogin = await request('POST', '/auth/login', {
      email: 'admin@almarkazia.com',
      password: 'admin123'
    });

    if (adminLogin.status !== 200) {
      console.log('Error Body:', JSON.stringify(adminLogin.data));
      throw new Error('Admin login failed');
    }
    const adminToken = adminLogin.data.data.accessToken;
    const adminHeaders = { 'Authorization': `Bearer ${adminToken}` };

    // Valid Status Transitions: pending -> preparing -> ready -> delivered
    console.log('[4/6] Transitioning order status...');
    
    await request('PATCH', `/orders/${orderId}/status`, { status: 'preparing' }, adminHeaders);
    console.log('   → PREPARING');
    
    await request('PATCH', `/orders/${orderId}/status`, { status: 'ready' }, adminHeaders);
    console.log('   → READY');

    const deliverRes = await request('PATCH', `/orders/${orderId}/status`, { status: 'delivered' }, adminHeaders);
    if (deliverRes.status !== 200) {
      console.log('Error Body:', JSON.stringify(deliverRes.data));
      throw new Error('Delivery status update failed');
    }
    console.log('✅ Order Status → DELIVERED');

    // 5. Verify Loyalty
    console.log('[5/6] Checking loyalty points accumulation...');
    // Give background job 1 second to settle
    await new Promise(r => setTimeout(r, 1000));
    const profile = await request('GET', '/auth/me', null, userHeaders);
    const points = profile.data.points || profile.data.data?.points || 0;
    
    if (points <= 0) {
       console.log('Profile Data:', JSON.stringify(profile.data));
       throw new Error('Points were not added to account');
    }
    console.log(`✅ Loyalty Points: ${points} (Correctly awarded)`);

    // 6. Verify Analytics
    console.log('[6/6] Checking Advanced Analytics grouping...');
    const analytics = await request('GET', '/analytics/dashboard?period=today', null, adminHeaders);
    
    if (analytics.status !== 200) {
      console.log('Error Body:', JSON.stringify(analytics.data));
      throw new Error(`Analytics fetch failed: ${analytics.status}`);
    }

    const hasCorrectLabels = analytics.data.data && analytics.data.data.chartData && analytics.data.data.chartData.some(d => d.label && (d.label.includes('ص') || d.label.includes('م')));
    if (!hasCorrectLabels) {
      console.log('Analytics Data:', JSON.stringify(analytics.data));
      throw new Error('Analytics labels are missing or incorrect');
    }
    console.log('✅ Analytics: Hourly labels (ص/م) confirmed');

    console.log('\n--- 🎊 FINAL REPORT: SYSTEM STABLE ---');
    console.log(`User: ${TEST_EMAIL}`);
    console.log(`Status: 100% Pass`);
    console.log(`Environment: Development/Test`);
    console.log('---------------------------------------');

  } catch (error) {
    console.error('\n❌ VERIFICATION FAILED');
    console.error(error.message);
    process.exit(1);
  }
}

run();
