import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * ⚡ Big Tech SRE Stress Scenario
 * Simulates business-driven load:
 * 1. Lunch Hour Surge (Ramping up)
 * 2. Mobile User Latency (Threshold checks)
 * 3. Auxiliary Throttling verification
 */

export const options = {
  stages: [
    { duration: '30s', target: 50 },  // Warmup
    { duration: '1m', target: 200 },  // Peak Regular
    { duration: '30s', target: 500 }, // Burst/Spike
    { duration: '30s', target: 0 },   // Cool down
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'], // Global < 1% error rate
    http_req_duration: ['p(95)<300'], // P95 < 300ms
  },
};

const BASE_URL = 'http://localhost:5000';

export default function () {
  // 1. Mission Critical: Fetch Menu
  const resMenu = http.get(`${BASE_URL}/items`);
  check(resMenu, {
    'menu status is 200': (r) => r.status === 200,
    'menu latency < 300ms': (r) => r.timings.duration < 300,
  });

  sleep(1);

  // 2. Auxiliary: Analytics/Stats (Throttled by Governor)
  // This might return 429 if load is high - which is EXPECTED behavior
  const resStats = http.get(`${BASE_URL}/analytics/dashboard-stats`);
  if (resStats.status === 429) {
    // Correctly Shedded
  } else {
    check(resStats, {
      'stats status ok or shedded': (r) => [200, 429].includes(r.status),
    });
  }

  sleep(2);
}
