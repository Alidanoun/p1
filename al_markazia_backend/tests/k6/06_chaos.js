import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 50,
  duration: '1m',
};

const BASE_URL = 'http://localhost:5000/api';

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImFkbWluLXRlc3QtaWQiLCJyb2xlIjoiYWRtaW4iLCJkYklkIjoxLCJpYXQiOjE3Nzg1MDI1MDYsImV4cCI6MTc3ODU4ODkwNn0.-dL5NHgsxKwfpfjjeO_fv0yxV0R8g8XGVGu4nQDpZHM';

export default function () {
  const params = {
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
    },
  };

  // Simulate hitting endpoints that might rely on downstream services (Redis, FCM, etc.)
  const res = http.get(`${BASE_URL}/system/event-health`, params);
  check(res, { 'status is 200': (r) => r.status === 200 });

  sleep(1);
}
