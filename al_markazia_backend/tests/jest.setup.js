// tests/jest.setup.js
process.env.NODE_ENV = 'test';
require('dotenv').config();

// Mock ioredis client to prevent socket connection errors during tests
jest.mock('ioredis', () => {
  const EventEmitter = require('events');
  const mockInstance = () => {
    const ee = new EventEmitter();
    return Object.assign(ee, {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      setex: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      ping: jest.fn().mockResolvedValue('PONG'),
      incr: jest.fn().mockResolvedValue(1),
      subscribe: jest.fn().mockResolvedValue(null),
      publish: jest.fn().mockResolvedValue(0),
      psubscribe: jest.fn().mockResolvedValue(null),
      punsubscribe: jest.fn().mockResolvedValue(null),
      defineCommand: jest.fn().mockResolvedValue('OK'),
      info: jest.fn().mockResolvedValue('redis_version:7.0.0'),
      quit: jest.fn().mockResolvedValue('OK'),
      duplicate: jest.fn().mockReturnThis(),
      expire: jest.fn().mockResolvedValue(1),
      ttl: jest.fn().mockResolvedValue(-1),
      options: { host: 'localhost', port: 6379, db: 0 },
      status: 'connecting',
      xgroup: jest.fn().mockResolvedValue('OK'),
      xadd: jest.fn().mockResolvedValue('1-0'),
      xack: jest.fn().mockResolvedValue(1),
      xautoclaim: jest.fn().mockResolvedValue(['0-0', []]),
      xreadgroup: jest.fn().mockResolvedValue([]),
    });
  };
  const MockRedis = jest.fn(mockInstance);
  MockRedis.prototype = EventEmitter.prototype;
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

