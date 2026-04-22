const http = require('http');

/**
 * 🛰️ SRE Baseline Verification (Tier 1)
 * Sends 100 concurrent-ish requests to verify system stability.
 */

const TOTAL_REQUESTS = 100;
const URL = 'http://localhost:5000/health/external';

async function runTest() {
  console.log(`🚀 Starting Baseline Test: ${TOTAL_REQUESTS} requests...`);
  
  const start = Date.now();
  const times = [];
  let successCount = 0;
  let failCount = 0;

  const requests = Array.from({ length: TOTAL_REQUESTS }).map(async (_, i) => {
    const reqStart = Date.now();
    return new Promise((resolve) => {
      http.get(URL, (res) => {
        const duration = Date.now() - reqStart;
        times.push(duration);
        if (res.statusCode === 200) successCount++;
        else failCount++;
        resolve();
      }).on('error', (err) => {
        failCount++;
        resolve();
      });
    });
  });

  await Promise.all(requests);
  const totalDuration = Date.now() - start;

  // Calculate Stats
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)] || 0;
  const avg = times.reduce((a, b) => a + b, 0) / times.length;

  console.log('\n--- 📊 Factual Baseline Results ---');
  console.log(`Success Rate: ${((successCount / TOTAL_REQUESTS) * 100).toFixed(2)}%`);
  console.log(`Failed/Throttled: ${failCount}`);
  console.log(`P95 Latency: ${p95}ms`);
  console.log(`Average Latency: ${avg.toFixed(2)}ms`);
  console.log(`Total Time: ${totalDuration}ms`);
  console.log('-----------------------------------\n');
}

runTest().catch(console.error);
