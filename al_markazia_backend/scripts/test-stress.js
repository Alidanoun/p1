const http = require('http');

/**
 * 🔥 SRE Stress Verification (Tier 2)
 * Sends 1000 requests to check Load Shedding & SLO Penalties.
 */

const TOTAL_REQUESTS = 1000;
const ENDPOINTS = [
  { name: 'MISSION_CRITICAL', url: 'http://localhost:5000/items' },
  { name: 'AUXILIARY', url: 'http://localhost:5000/analytics/dashboard-stats' }
];

async function runTest() {
  console.log(`🔥 Starting Stress Test: ${TOTAL_REQUESTS} requests...`);
  
  const results = {
    MISSION_CRITICAL: { success: 0, shedded: 0, failed: 0, times: [] },
    AUXILIARY: { success: 0, shedded: 0, failed: 0, times: [] }
  };

  const start = Date.now();

  const requests = Array.from({ length: TOTAL_REQUESTS }).map(async (_, i) => {
    const target = ENDPOINTS[i % 2];
    const reqStart = Date.now();
    
    return new Promise((resolve) => {
      http.get(target.url, (res) => {
        const duration = Date.now() - reqStart;
        results[target.name].times.push(duration);

        if (res.statusCode === 200) results[target.name].success++;
        else if (res.statusCode === 429) results[target.name].shedded++;
        else results[target.name].failed++;
        
        resolve();
      }).on('error', () => {
        results[target.name].failed++;
        resolve();
      });
    });
  });

  await Promise.all(requests);
  const totalDuration = Date.now() - start;

  console.log('\n--- 🔥 Factual Stress Results ---');
  for (const [name, data] of Object.entries(results)) {
    data.times.sort((a, b) => a - b);
    const p95 = data.times[Math.floor(data.times.length * 0.95)] || 0;
    console.log(`[${name}]`);
    console.log(`  Success Rate: ${((data.success / (TOTAL_REQUESTS/2)) * 100).toFixed(2)}%`);
    console.log(`  Shedded (429): ${data.shedded}`);
    console.log(`  Failed: ${data.failed}`);
    console.log(`  P95 Latency: ${p95}ms`);
  }
  console.log(`Total Execution Time: ${totalDuration}ms`);
  console.log('----------------------------------\n');
}

runTest().catch(console.error);
