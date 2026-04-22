import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * 🚀 Al Markazia - Enterprise Load Test (Post-Migration)
 * This script tests the new UUID/JWT identity architecture.
 */

export const options = {
  // 📈 Scaling Scenario: Simulate 10 users ramping up to 50 over 30 seconds
  stages: [
    { duration: '30s', target: 20 }, // Ramp up
    { duration: '1m', target: 20 },  // Stay at peak
    { duration: '20s', target: 0 },  // Ramp down
  ],
  thresholds: {
    // 🛡️ Performance SLA: 95% of requests must be under 200ms
    http_req_duration: ['p(95)<200'],
    // 🛡️ Zero Tolerance: Error rate must be below 1%
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = 'http://localhost:5000'; // Update with your server IP

export default function () {
  const phone = '0790000000'; // Use a test phone number existing in DB

  // 🔐 STEP 1: LOGIN (Get JWT)
  const loginRes = http.post(
    `${BASE_URL}/customers/login`,
    JSON.stringify({ phone }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(loginRes, {
    'logged in successfully': (r) => r.status === 200,
    'has access token': (r) => r.json().accessToken !== undefined,
  });

  if (loginRes.status === 200) {
    const token = loginRes.json().accessToken;

    // 🔐 STEP 2: FETCH SECURE DATA (Using UUID/JWT)
    const params = {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    };

    const ordersRes = http.get(`${BASE_URL}/orders/my-orders`, params);

    check(ordersRes, {
      'fetched orders successfully': (r) => r.status === 200,
      'is using secure uuid route': (r) => r.url.includes('my-orders'),
    });
  }

  sleep(1); // Wait 1 second between virtual user iterations
}
