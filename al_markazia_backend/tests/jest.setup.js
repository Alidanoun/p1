// tests/jest.setup.js
// إعدادات عامة لبيئة الاختبار

// كتم تحذيرات معينة في وضع الاختبار
if (process.env.NODE_ENV === 'test') {
  // يمكن إضافة إعدادات إضافية هنا
}

// دالة مساعدة لتأخير التنفيذ (مفيدة في اختبارات التزامن)
global.delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// تنظيف الـ mocks بعد كل اختبار
afterEach(() => {
  jest.clearAllMocks();
});
