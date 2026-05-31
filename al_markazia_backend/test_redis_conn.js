const Redis = require('ioredis');

const baseConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  username: process.env.REDIS_USERNAME || undefined,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  connectTimeout: 5000,
};

console.log('Connecting to Redis with config:', {
  host: baseConfig.host,
  port: baseConfig.port,
  username: baseConfig.username,
  password: baseConfig.password ? 'SET (length ' + baseConfig.password.length + ')' : 'NOT_SET'
});

const redis = new Redis(baseConfig);

redis.on('connect', () => {
  console.log('Connected!');
  redis.ping().then(res => {
    console.log('PING response:', res);
    process.exit(0);
  }).catch(err => {
    console.error('PING error:', err);
    process.exit(1);
  });
});

redis.on('error', (err) => {
  console.error('Redis error event:', err.message);
});

setTimeout(() => {
  console.log('Timeout reached, status is:', redis.status);
  process.exit(1);
}, 12000);
