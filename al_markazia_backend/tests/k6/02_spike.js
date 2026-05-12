import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 50 },   // Normal load
    { duration: '20s', target: 500 },  // Sudden spike (scaled down from 2000 for local test)
    { duration: '10s', target: 50 },   // Fallback
  ],
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
  
  sleep(0.1); // Rapid requests during spike
}
