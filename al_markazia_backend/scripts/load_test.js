const autocannon = require('autocannon');
const logger = require('../src/utils/logger');

async function runTest(name, url, options = {}) {
  console.log(`\n🚀 Starting Load Test: ${name}`);
  console.log(`🔗 URL: ${url}`);
  
  const result = await autocannon({
    url,
    connections: 100,
    duration: 10,
    ...options
  });

  console.log(`\n📊 Results for ${name}:`);
  console.log(`   Requests/sec: ${result.requests.average}`);
  console.log(`   Latency (ms) - Avg: ${result.latency.average}, P99: ${result.latency.p99}`);
  console.log(`   Total Requests: ${result.requests.total}`);
  console.log(`   Errors: ${result.errors}`);
  
  return result;
}

async function main() {
  try {
    // Test 1: Public Config (Redis Cache)
    await runTest('System Config (Redis Cached)', 'http://localhost:5000/api/v1/system/config');

    // Test 2: Public Health Check
    await runTest('Health Check', 'http://localhost:5000/health/external');

    console.log('\n✅ Load Testing Completed.');
  } catch (err) {
    console.error('❌ Load Test Failed:', err);
  }
}

main();
