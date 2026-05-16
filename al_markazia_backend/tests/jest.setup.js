// tests/jest.setup.js
require('dotenv').config();
if (process.env.NODE_ENV === 'test') {
  // كتم تحذيرات معينة في وضع الاختبار
  process.env.SKIP_SECRETS_VALIDATION = 'true';
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
