import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 200,
  duration: '1m',
};

const BASE_URL = 'http://localhost:5000/api';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImFkbWluLXRlc3QtaWQiLCJyb2xlIjoiYWRtaW4iLCJkYklkIjoxLCJpYXQiOjE3Nzg1MDI1MDYsImV4cCI6MTc3ODU4ODkwNn0.-dL5NHgsxKwfpfjjeO_fv0yxV0R8g8XGVGu4nQDpZHM';

export default function () {
  const payload = JSON.stringify({
    customerName: 'Test Load',
    customerPhone: '0790000000',
    orderType: 'delivery',
    branchId: 'branch-1',
    items: [{ itemId: 1, quantity: 1, unitPrice: 5.5 }]
  });

  const params = {
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
  };

  // High production rate of orders to trigger outbox/backpressure
  const res = http.post(`${BASE_URL}/orders`, payload, params);
  check(res, { 'order created': (r) => r.status === 201 || r.status === 429 }); // 429 is success for backpressure test

  sleep(0.1); 
}
