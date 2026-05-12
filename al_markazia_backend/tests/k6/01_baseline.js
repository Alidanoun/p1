import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 50,
  duration: '1m', // Reduced from 10m for immediate testing
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests must be below 500ms
    http_req_failed: ['rate<0.01'],   // Error rate should be less than 1%
  },
};

const BASE_URL = 'http://localhost:5000/api';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImFkbWluLXRlc3QtaWQiLCJyb2xlIjoiYWRtaW4iLCJkYklkIjoxLCJpYXQiOjE3Nzg1MDI1MDYsImV4cCI6MTc3ODU4ODkwNn0.-dL5NHgsxKwfpfjjeO_fv0yxV0R8g8XGVGu4nQDpZHM';

export default function () {
  const params = {
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
  };

  // 1. Get Categories (Read)
  const res1 = http.get(`${BASE_URL}/categories`, params);
  check(res1, { 'status is 200': (r) => r.status === 200 });

  sleep(1);

  // 2. Get Items (Read)
  const res2 = http.get(`${BASE_URL}/items?admin=true`, params);
  check(res2, { 'status is 200': (r) => r.status === 200 });

  sleep(Math.random() * 2 + 1);
}
