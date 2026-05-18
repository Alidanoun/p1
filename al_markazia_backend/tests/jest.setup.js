// tests/jest.setup.js
require('dotenv').config();
if (process.env.NODE_ENV === 'test') {
  // توليد مفاتيح حقيقية لبيئة الاختبارات لتفادي تجاوز التحقق
  const crypto = require('crypto');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  process.env.JWT_PRIVATE_KEY = process.env.JWT_PRIVATE_KEY || privateKey;
  process.env.JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY || publicKey;
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
