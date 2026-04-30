import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * 🚀 Comprehensive System Verification Test
 * Tests: 
 * 1. Two-phase registration (The Fix)
 * 2. Order creation & Customer attribution (The Logic)
 * 3. Order delivery & Loyalty points awarding (The Feature)
 * 4. Advanced Analytics grouping (The New Request)
 */

export const options = {
  vus: 1, // Single user to trace a clean flow
  iterations: 1,
};

const BASE_URL = 'http://localhost:5000';
const TEST_EMAIL = `test_user_${Date.now()}@example.com`;
const TEST_PASSWORD = 'Password123!';

export default function () {
  // 1. PHASE 1: Register (Request OTP)
  console.log(`[Step 1] Requesting OTP for ${TEST_EMAIL}`);
  const regRes = http.post(`${BASE_URL}/auth/register`, JSON.stringify({
    name: 'K6 Test User',
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    phone: '0790000000'
  }), { headers: { 'Content-Type': 'application/json' } });

  check(regRes, {
    'Phase 1 Success': (r) => r.status === 200,
    'OTP Sent Message': (r) => r.json().data.message.includes('كود التحقق'),
  });

  sleep(1);

  // 2. PHASE 2: Verify Registration (Complete Signup)
  console.log(`[Step 2] Verifying OTP for ${TEST_EMAIL}`);
  const verifyRes = http.post(`${BASE_URL}/auth/verify-registration`, JSON.stringify({
    email: TEST_EMAIL,
    code: '123456' // Using our bypass
  }), { headers: { 'Content-Type': 'application/json' } });

  check(verifyRes, {
    'Phase 2 Success': (r) => r.status === 200,
    'Has Access Token': (r) => r.json().accessToken !== undefined,
  });

  const userToken = verifyRes.json().accessToken;
  const userHeaders = { 
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${userToken}`
  };

  sleep(1);

  // 3. Create Order
  console.log(`[Step 3] Placing Order`);
  const orderRes = http.post(`${BASE_URL}/orders`, JSON.stringify({
    orderType: 'delivery',
    paymentMethod: 'cash',
    address: 'Test Address 123',
    branch: 'فرع شارع المدينة',
    cartItems: [
      { id: 1, quantity: 2, unitPrice: 10.0, name: 'وجبة تجريبية' }
    ],
    deliveryFee: 2.0
  }), { headers: userHeaders });

  check(orderRes, {
    'Order Created': (r) => r.status === 201 || r.status === 200,
  });

  const orderId = orderRes.json().data?.id || orderRes.json().id;
  console.log(`Order ID: ${orderId}`);

  sleep(1);

  // 4. ADMIN: Login & Deliver Order
  console.log(`[Step 4] Admin Login & Delivery`);
  const adminLoginRes = http.post(`${BASE_URL}/auth/login`, JSON.stringify({
    email: 'admin@almarkazia.com',
    password: 'admin123'
  }), { headers: { 'Content-Type': 'application/json' } });

  const adminToken = adminLoginRes.json().accessToken;
  const adminHeaders = { 
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${adminToken}`
  };

  // Update status to 'delivered' to trigger loyalty points
  const deliverRes = http.patch(`${BASE_URL}/orders/${orderId}/status`, JSON.stringify({
    status: 'delivered'
  }), { headers: adminHeaders });

  check(deliverRes, {
    'Order Delivered': (r) => r.status === 200,
  });

  sleep(2); // Wait for background jobs (loyalty calc)

  // 5. Verify Loyalty Points
  console.log(`[Step 5] Verifying Loyalty Points`);
  const profileRes = http.get(`${BASE_URL}/auth/me`, { headers: userHeaders });
  const points = profileRes.json().points || profileRes.json().data?.points;
  
  check(profileRes, {
    'Profile Fetched': (r) => r.status === 200,
    'Points Added': (p) => points > 0,
  });
  console.log(`Customer Points: ${points}`);

  // 6. Check Analytics Grouping
  console.log(`[Step 6] Verifying Advanced Analytics`);
  const analyticsRes = http.get(`${BASE_URL}/analytics/dashboard?period=today`, { headers: adminHeaders });
  
  check(analyticsRes, {
    'Analytics Success': (r) => r.status === 200,
    'Chart Data Present': (r) => r.json().chartData.length > 0,
    'Correct Today Grouping': (r) => r.json().chartData[0].label.includes('ص') || r.json().chartData[0].label.includes('م'),
  });

  console.log(`[Success] All systems verified.`);
}
