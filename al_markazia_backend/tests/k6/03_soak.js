import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 100,
  duration: '2m', // Scaled down from 6h for demonstration
};

const BASE_URL = 'http://localhost:5000/api';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImFkbWluLXRlc3QtaWQiLCJyb2xlIjoiYWRtaW4iLCJkYklkIjoxLCJpYXQiOjE3Nzg1MDI1MDYsImV4cCI6MTc3ODU4ODkwNn0.-dL5NHgsxKwfpfjjeO_fv0yxV0R8g8XGVGu4nQDpZHM';

export default function () {
  const params = {
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
    },
  };

  const res = http.get(`${BASE_URL}/items`, params);
  check(res, { 'status is 200': (r) => r.status === 200 });

  sleep(2);
}
