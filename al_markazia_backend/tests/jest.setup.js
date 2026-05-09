// tests/jest.setup.js
if (process.env.NODE_ENV === 'test') {
  // كتم تحذيرات معينة في وضع الاختبار
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_ci_only';
  process.env.SENTRY_DSN = ''; // تعطيل Sentry في الاختبارات
}

// دالة مساعدة للتأخير (مفيدة في اختبارات التزامن)
global.delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// تنظيف mocks بعد كل اختبار
afterEach(() => {
  jest.clearAllMocks();
});
