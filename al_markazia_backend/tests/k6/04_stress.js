import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 100 },
    { duration: '30s', target: 500 },
    { duration: '30s', target: 1000 }, // Scaled down from 10k
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.10'],
  },
};

const BASE_URL = 'http://localhost:5000/api';

export default function () {
  const res = http.get(`${BASE_URL}/items`);
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(0.5);
}
