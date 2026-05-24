// tests/jest.setup.js
process.env.NODE_ENV = 'test';
require('dotenv').config();

// Mock ioredis client to prevent socket connection errors during tests
jest.mock('ioredis', () => {
  const MockRedis = jest.fn().mockImplementation(() => {
    return {
      on: jest.fn(),
      duplicate: jest.fn().mockReturnThis(),
      options: { db: 0 },
      status: 'connecting',
      get: jest.fn(() => Promise.resolve(null)),
      set: jest.fn(() => Promise.resolve('OK')),
      setex: jest.fn(() => Promise.resolve('OK')),
      del: jest.fn(() => Promise.resolve(0)),
      incr: jest.fn(() => Promise.resolve(1)),
      expire: jest.fn(() => Promise.resolve(1)),
      ttl: jest.fn(() => Promise.resolve(-1)),
      ping: jest.fn(() => Promise.resolve('PONG')),
      quit: jest.fn(() => Promise.resolve('OK')),
      subscribe: jest.fn(() => Promise.resolve('OK')),
      unsubscribe: jest.fn(() => Promise.resolve('OK')),
      psubscribe: jest.fn(() => Promise.resolve('OK')),
      punsubscribe: jest.fn(() => Promise.resolve('OK')),
      send_command: jest.fn((cmd, args, cb) => {
        if (cb) cb(null, 1);
        return Promise.resolve(1);
      }),
    };
  });
  MockRedis.default = MockRedis;
  return MockRedis;
});


if (process.env.NODE_ENV === 'test') {
  // توليد مفاتيح حقيقية لبيئة الاختبارات لتفادي تجاوز التحقق
  const crypto = require('crypto');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  process.env.JWT_PRIVATE_KEY = privateKey;
  process.env.JWT_PUBLIC_KEY = publicKey;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_ci_only_long_enough_32_chars';
  process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'test_refresh_secret_long_enough_32_chars';
  process.env.SENTRY_DSN = ''; // تعطيل Sentry في الاختبارات
}

// دالة مساعدة للتأخير (مفيدة في اختبارات التزامن)
global.delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// تنظيف mocks بعد كل اختبار
afterEach(() => {
  jest.clearAllMocks();
});

