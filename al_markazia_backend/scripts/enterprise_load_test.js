import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

export const options = {
  vus: 10,
  duration: '1m',
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests should be below 500ms
    http_req_failed: ['rate<0.01'],    // Less than 1% of requests should fail
  },
};

const BASE_URL = 'http://localhost:5000';

function generateJordanianPhone() {
  const digits = '0123456789';
  let phone = '079';
  for (let i = 0; i < 7; i++) {
    phone += digits.charAt(Math.floor(Math.random() * digits.length));
  }
  return phone;
}

export default function () {
  const phone = generateJordanianPhone();
  const name = `LoadTestUser_${randomString(5)}`;

  // 1. Register New Customer
  const registerPayload = JSON.stringify({
    name: name,
    phone: phone,
  });

  const registerRes = http.post(`${BASE_URL}/customers/register`, registerPayload, {
    headers: { 'Content-Type': 'application/json' },
  });

  check(registerRes, {
    'registration successful': (r) => r.status === 200,
    'has access token': (r) => r.json().accessToken !== undefined,
  });

  if (registerRes.status !== 200) {
    console.error(`Registration failed for ${phone}: ${registerRes.body}`);
    return;
  }

  const accessToken = registerRes.json().accessToken;
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  };

  sleep(1);

  // 2. Fetch Menu Items (Simulate Browsing)
  const menuRes = http.get(`${BASE_URL}/items`, { headers: authHeaders });
  
  check(menuRes, {
    'menu fetched': (r) => r.status === 200,
    'items available': (r) => Array.isArray(r.json()) && r.json().length > 0,
  });

  if (menuRes.status !== 200 || !menuRes.json().length) {
    return;
  }

  const items = menuRes.json();
  const randomItem = items[Math.floor(Math.random() * items.length)];

  sleep(2);

  // 3. Select Delivery Zone & Place Order
  // Simulating the payload found in CheckoutScreen.dart
  const orderPayload = JSON.stringify({
    customerName: name,
    customerPhone: phone,
    orderType: 'delivery',
    paymentMethod: 'cash',
    address: 'Street 10, Building 5, Load Test Area',
    branch: 'فرع شارع المدينة',
    deliveryFee: 2.0,
    tax: 0,
    cartItems: [
      {
        id: randomItem.id,
        quantity: 1,
        unitPrice: randomItem.basePrice,
        name: randomItem.title,
      }
    ],
    notes: 'K6 Performance Test Order',
  });

  const orderRes = http.post(`${BASE_URL}/orders`, orderPayload, {
    headers: authHeaders,
  });

  check(orderRes, {
    'order created': (r) => r.status === 201 || r.status === 200,
    'has order number': (r) => r.json().orderNumber !== undefined || r.json().data?.orderNumber !== undefined,
  });

  if (orderRes.status !== 201 && orderRes.status !== 200) {
    console.error(`Order failed: ${orderRes.status} - ${orderRes.body}`);
  }

  sleep(3); // Wait before next iteration
}
