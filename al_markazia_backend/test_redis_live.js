// Quick Redis connectivity test
const Redis = require('ioredis');

// Test 1: No auth connection
const noAuth = new Redis({ host: 'redis', port: 6379, connectTimeout: 5000, maxRetriesPerRequest: 1 });
noAuth.on('connect', () => { console.log('TEST1_NO_AUTH: Connected'); });
noAuth.on('error', (e) => { console.log('TEST1_NO_AUTH_ERR:', e.message); });

// Test 2: Try with env vars
const withAuth = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: process.env.REDIS_PORT || 6379,
  username: process.env.REDIS_USERNAME || undefined,
  password: process.env.REDIS_PASSWORD || undefined,
  connectTimeout: 5000,
  maxRetriesPerRequest: 1
});
withAuth.on('connect', () => { console.log('TEST2_WITH_AUTH: Connected'); });
withAuth.on('error', (e) => { console.log('TEST2_WITH_AUTH_ERR:', e.message); });

setTimeout(async () => {
  try {
    const r1 = await noAuth.ping();
    console.log('TEST1_PING:', r1);
  } catch(e) {
    console.log('TEST1_PING_FAIL:', e.message);
  }
  try {
    const r2 = await withAuth.ping();
    console.log('TEST2_PING:', r2);
  } catch(e) {
    console.log('TEST2_PING_FAIL:', e.message);
  }

  console.log('ENV_REDIS_HOST:', process.env.REDIS_HOST);
  console.log('ENV_REDIS_PORT:', process.env.REDIS_PORT);
  console.log('ENV_REDIS_USERNAME:', process.env.REDIS_USERNAME);
  console.log('ENV_REDIS_PASSWORD:', process.env.REDIS_PASSWORD ? '***SET***' : 'NOT_SET');

  noAuth.quit().catch(()=>{});
  withAuth.quit().catch(()=>{});
  setTimeout(() => process.exit(0), 1000);
}, 6000);
